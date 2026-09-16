-- ==============================================================================
-- 0005_lease_and_queue.sql
-- Lease-based claiming (C4), rate-limit-aware quarantine (H4), queue
-- constraint (H7), atomic pairing (P8), stuck-message guards.
--
-- BREAKING: claim_next_sms / report_sms_result now require p_device_token.
-- ==============================================================================

-- -----------------------------------------------------------------------------
-- 1. Schema additions
-- -----------------------------------------------------------------------------
alter table outbound_messages add column if not exists lease_expires_at timestamptz;
alter table sim_subscriptions add column if not exists rate_limited_today int not null default 0;

create index if not exists idx_outbound_leases
  on outbound_messages(lease_expires_at)
  where status = 'processing';

-- requested_sim_slot must be a real slot (H7) — added NOT VALID, validated
-- after existing bad rows are cleaned.
alter table outbound_messages
  add constraint chk_requested_sim_slot
  check (requested_sim_slot is null or requested_sim_slot in (0, 1))
  not valid;

update outbound_messages
set requested_sim_slot = null
where requested_sim_slot is not null and requested_sim_slot not in (0, 1);

alter table outbound_messages validate constraint chk_requested_sim_slot;

-- -----------------------------------------------------------------------------
-- 2. claim_next_sms — lease model, no hot-path global resets (C4, P1)
-- -----------------------------------------------------------------------------
create or replace function claim_next_sms(
  p_device_id uuid,
  p_device_token text
) returns table (
  message_id uuid,
  organization_id uuid,
  phone_number text,
  message text,
  sim_subscription_id uuid,
  sim_slot int
) security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_message_id uuid;
  v_org_id uuid;
  v_phone text;
  v_text text;
  v_sim_id uuid;
  v_sim_slot int;
begin
  perform verify_device_auth(p_device_id, p_device_token);

  -- Select next pending message and optimal matching eligible SIM on this device
  select om.id, om.organization_id, om.phone_number, om.message, s.id, s.sim_slot
  into v_message_id, v_org_id, v_phone, v_text, v_sim_id, v_sim_slot
  from outbound_messages om
  join gateway_devices gd on gd.id = p_device_id and gd.organization_id = om.organization_id
  join lateral (
    select s.id, s.sim_slot
    from sim_subscriptions s
    where s.device_id = p_device_id
      and s.status = 'active'
      and s.available_balance > 0
      and s.sent_today < s.daily_limit
      and (om.requested_sim_slot is null or om.requested_sim_slot = s.sim_slot)
    order by s.expires_at asc nulls last, s.available_balance asc
    limit 1
  ) s on true
  where om.status = 'pending'
  order by om.created_at asc
  limit 1
  for update of om skip locked;

  if v_message_id is null then
    return;
  end if;

  update outbound_messages
  set status = 'processing',
      device_id = p_device_id,
      sim_subscription_id = v_sim_id,
      lease_expires_at = now() + interval '15 minutes',
      processed_at = now(),
      updated_at = now()
  where id = v_message_id;

  return query
  select v_message_id, v_org_id, v_phone, v_text, v_sim_id, v_sim_slot;
end;
$$ language plpgsql;

-- -----------------------------------------------------------------------------
-- 3. report_sms_result — idempotent, lease-aware, quarantine only for real
--    carrier faults (never OS rate limiting) (C4, H4)
-- -----------------------------------------------------------------------------
create or replace function report_sms_result(
  p_message_id uuid,
  p_device_id uuid,
  p_device_token text,
  p_status text,
  p_error_code int default null,
  p_error_message text default null
) returns void security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_msg record;
  v_sim_id uuid;
  v_failures int;
  v_is_carrier_error boolean;
  v_is_rate_limit boolean;
begin
  perform verify_device_auth(p_device_id, p_device_token);

  select * into v_msg
  from outbound_messages
  where id = p_message_id;

  if v_msg.id is null then
    return;
  end if;

  v_sim_id := v_msg.sim_subscription_id;

  -- Android SmsManager result codes:
  -- 1 GENERIC_FAILURE, 2 RADIO_OFF, 3 NULL_PDU, 4 NO_SERVICE (carrier faults),
  -- 5 LIMIT_EXCEEDED (OS rate limit — NEVER quarantine for this),
  -- 9001 gateway-internal "requested SIM slot not active".
  v_is_carrier_error := p_error_code in (1, 2, 3, 4) or p_error_code is null;
  v_is_rate_limit := p_error_code = 5;

  if p_status = 'sent' then
    -- Idempotency guard: decrement balance exactly once (processing -> sent)
    if v_msg.status = 'processing' then
      update outbound_messages
      set status = 'sent',
          sent_at = coalesce(sent_at, now()),
          lease_expires_at = null,
          updated_at = now()
      where id = p_message_id;

      if v_sim_id is not null then
        update sim_subscriptions
        set available_balance = greatest(0, available_balance - 1),
            sent_today = sent_today + 1,
            consecutive_failures = 0,
            status = case when available_balance - 1 <= 0 then 'exhausted' else status end,
            updated_at = now()
        where id = v_sim_id;
      end if;
    end if;

  elsif p_status = 'delivered' then
    update outbound_messages
    set status = 'delivered',
        delivered_at = now(),
        lease_expires_at = null,
        updated_at = now()
    where id = p_message_id;

  elsif p_status = 'failed' then
    if v_sim_id is not null and v_is_carrier_error and not v_is_rate_limit then
      update sim_subscriptions
      set consecutive_failures = consecutive_failures + 1,
          updated_at = now()
      where id = v_sim_id
      returning consecutive_failures into v_failures;

      -- Auto-quarantine only after 3 consecutive REAL carrier radio failures
      if v_failures >= 3 then
        update sim_subscriptions
        set status = 'quarantined',
            quarantined_reason = coalesce(p_error_message, 'Auto-quarantined: 3 consecutive carrier radio failures'),
            updated_at = now()
        where id = v_sim_id;
      end if;
    elsif v_sim_id is not null and v_is_rate_limit then
      -- OS/carrier throttling caused by our own pacing: count separately,
      -- never quarantine a healthy SIM (H4).
      update sim_subscriptions
      set rate_limited_today = rate_limited_today + 1,
          consecutive_failures = 0,
          updated_at = now()
      where id = v_sim_id;
    end if;

    -- Failover: retries remaining -> back to pending; else permanent failure
    if v_msg.retry_count + 1 < v_msg.max_retries then
      update outbound_messages
      set status = 'pending',
          retry_count = retry_count + 1,
          device_id = null,
          sim_subscription_id = null,
          lease_expires_at = null,
          error_code = p_error_code,
          error_message = 'Failover attempt ' || (v_msg.retry_count + 1) || ': ' || coalesce(p_error_message, 'Transmission error'),
          updated_at = now()
      where id = p_message_id;
    else
      update outbound_messages
      set status = 'failed',
          retry_count = v_msg.retry_count + 1,
          lease_expires_at = null,
          error_code = p_error_code,
          error_message = p_error_message,
          updated_at = now()
      where id = p_message_id;
    end if;
  end if;
end;
$$ language plpgsql;

-- -----------------------------------------------------------------------------
-- 4. Lease sweeper — replaces the in-claim orphan reset (C4: counts as a retry,
--    so a claim-crash loop can no longer redeliver forever)
-- -----------------------------------------------------------------------------
create or replace function sweep_expired_leases()
returns void security definer set search_path = public as $$
begin
  update outbound_messages
  set status = case
        when retry_count + 1 >= max_retries then 'failed'
        else 'pending'
      end,
      retry_count = retry_count + 1,
      device_id = null,
      sim_subscription_id = null,
      lease_expires_at = null,
      error_message = 'Lease expired: device lost while processing',
      updated_at = now()
  where status = 'processing'
    and lease_expires_at is not null
    and lease_expires_at < now();
end;
$$ language plpgsql;


-- -----------------------------------------------------------------------------
-- 5. Stuck-message guards (H7 / 2.8)
-- -----------------------------------------------------------------------------
-- Messages whose pinned SIM never becomes eligible get unpinned after 1 h so
-- they can flow to any healthy SIM.
create or replace function unpin_stale_sim_requests()
returns void security definer set search_path = public as $$
begin
  update outbound_messages om
  set requested_sim_slot = null,
      updated_at = now()
  where om.status = 'pending'
    and om.requested_sim_slot is not null
    and om.created_at < now() - interval '1 hour'
    and not exists (
      select 1 from sim_subscriptions s
      where s.organization_id = om.organization_id
        and s.sim_slot = om.requested_sim_slot
        and s.status = 'active'
        and s.available_balance > 0
    );
end;
$$ language plpgsql;

-- Pending messages older than 24 h are cancelled so queues never grow forever.
create or replace function cancel_stuck_messages()
returns void security definer set search_path = public as $$
begin
  update outbound_messages
  set status = 'cancelled',
      error_message = coalesce(error_message, 'Queue timeout: not deliverable within 24 hours'),
      updated_at = now()
  where status = 'pending'
    and created_at < now() - interval '24 hours';
end;
$$ language plpgsql;

-- -----------------------------------------------------------------------------
-- 6. Atomic pairing (P8) — concurrent scans of the same QR create one device
-- -----------------------------------------------------------------------------
create or replace function complete_device_pairing(
  p_pairing_code text,
  p_device_name text,
  p_device_token_hash text,
  p_android_ver text,
  p_app_ver text
) returns table (
  device_id uuid,
  organization_id uuid,
  org_name text
) security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_session record;
  v_device_id uuid;
begin
  select * into v_session
  from device_pairing_sessions
  where (upper(replace(pairing_code, '-', '')) = upper(replace(p_pairing_code, '-', '')) or pairing_code = p_pairing_code)
    and status = 'pending'
    and expires_at > now()
  order by created_at desc
  limit 1
  for update;  -- lock the session row: concurrent claims serialize here

  if v_session.id is null then
    raise exception 'Invalid or expired pairing code';
  end if;

  update device_pairing_sessions
  set status = 'claimed'
  where id = v_session.id;

  insert into gateway_devices (
    organization_id, name, device_token_hash, android_version, app_version,
    status, last_heartbeat_at
  ) values (
    v_session.organization_id, p_device_name, p_device_token_hash, p_android_ver,
    p_app_ver, 'online', now()
  ) returning id into v_device_id;

  insert into sim_subscriptions (organization_id, device_id, sim_slot, carrier_name, available_balance, status)
  values
    (v_session.organization_id, v_device_id, 0, 'SIM 1', 0, 'active'),
    (v_session.organization_id, v_device_id, 1, 'SIM 2', 0, 'active')
  on conflict (device_id, sim_slot) do nothing;

  update device_pairing_sessions
  set device_id = v_device_id
  where id = v_session.id;

  return query
  select gd.id, gd.organization_id, org.name
  from gateway_devices gd
  join organizations org on org.id = gd.organization_id
  where gd.id = v_device_id;
end;
$$ language plpgsql;

