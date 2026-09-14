-- ==============================================================================
-- 0002_functions_and_triggers.sql: Queue Procedures, Perfect SIM Routing & Failover
-- ==============================================================================

-- 1. Daily Quota Reset Helper
create or replace function reset_daily_sim_counters()
returns void security definer set search_path = public as $$
begin
  update sim_subscriptions
  set sent_today = 0,
      last_sent_date = current_date
  where last_sent_date < current_date;
end;
$$ language plpgsql;

-- 2. Claim Next SMS (Atomically claims message using Earliest Expiry / Lowest Balance)
create or replace function claim_next_sms(p_device_id uuid)
returns table (
  message_id uuid,
  organization_id uuid,
  phone_number text,
  message text,
  sim_subscription_id uuid,
  sim_slot int
) security definer set search_path = public as $$
declare
  v_sim record;
  v_message_id uuid;
  v_org_id uuid;
  v_phone text;
  v_text text;
begin
  -- Ensure daily counters are refreshed
  perform reset_daily_sim_counters();

  -- Select the "Perfect SIM" on this device:
  -- Active, with balance, under daily limit, ordered by earliest expiry then lowest balance
  select id, sim_slot
  into v_sim
  from sim_subscriptions
  where device_id = p_device_id
    and status = 'active'
    and available_balance > 0
    and sent_today < daily_limit
  order by expires_at asc nulls last, available_balance asc
  limit 1;

  if v_sim.id is null then
    return; -- No healthy SIM available on this device right now
  end if;

  -- Select and lock next pending message for this device's organization
  select om.id, om.organization_id, om.phone_number, om.message
  into v_message_id, v_org_id, v_phone, v_text
  from outbound_messages om
  join gateway_devices gd on gd.id = p_device_id
  where om.organization_id = gd.organization_id
    and om.status = 'pending'
    and (om.requested_sim_slot is null or om.requested_sim_slot = v_sim.sim_slot)
  order by om.created_at asc
  limit 1
  for update skip locked;

  if v_message_id is null then
    return; -- No pending messages in queue
  end if;

  -- Transition message to processing
  update outbound_messages
  set status = 'processing',
      device_id = p_device_id,
      sim_subscription_id = v_sim.id,
      processed_at = now(),
      updated_at = now()
  where id = v_message_id;

  return query
  select v_message_id, v_org_id, v_phone, v_text, v_sim.id, v_sim.sim_slot;
end;
$$ language plpgsql;

-- 3. Report SMS Result (Verification, Balance Deduction, Auto-Quarantine & Failover)
create or replace function report_sms_result(
  p_message_id uuid,
  p_device_id uuid,
  p_status text, -- 'sent', 'delivered', 'failed'
  p_error_code int default null,
  p_error_message text default null
) returns void security definer set search_path = public as $$
declare
  v_msg record;
  v_sim_id uuid;
  v_failures int;
begin
  select * into v_msg
  from outbound_messages
  where id = p_message_id;

  if v_msg.id is null then
    return;
  end if;

  v_sim_id := v_msg.sim_subscription_id;

  if p_status = 'sent' then
    -- Successful cellular handoff
    update outbound_messages
    set status = 'sent',
        sent_at = coalesce(sent_at, now()),
        updated_at = now()
    where id = p_message_id;

    -- Update SIM counters: decrement balance, increment sent_today, clear failure count
    if v_sim_id is not null then
      update sim_subscriptions
      set available_balance = greatest(0, available_balance - 1),
          sent_today = sent_today + 1,
          consecutive_failures = 0,
          status = case when available_balance - 1 <= 0 then 'exhausted' else status end,
          updated_at = now()
      where id = v_sim_id;
    end if;

  elsif p_status = 'delivered' then
    -- Carrier delivery confirmation (DLR)
    update outbound_messages
    set status = 'delivered',
        delivered_at = now(),
        updated_at = now()
    where id = p_message_id;

  elsif p_status = 'failed' then
    -- Transmission failed on this SIM
    if v_sim_id is not null then
      update sim_subscriptions
      set consecutive_failures = consecutive_failures + 1,
          updated_at = now()
      returning consecutive_failures into v_failures;

      -- Auto-Quarantine rule: 3 consecutive failures isolates the SIM
      if v_failures >= 3 then
        update sim_subscriptions
        set status = 'quarantined',
            quarantined_reason = coalesce(p_error_message, 'Auto-quarantined: 3 consecutive carrier failures'),
            updated_at = now()
        where id = v_sim_id;
      end if;
    end if;

    -- Failover logic: if retries remain, revert to pending so another eligible SIM picks it up
    if v_msg.retry_count + 1 < v_msg.max_retries then
      update outbound_messages
      set status = 'pending',
          retry_count = retry_count + 1,
          device_id = null,
          sim_subscription_id = null,
          error_code = p_error_code,
          error_message = 'Failover attempt ' || (v_msg.retry_count + 1) || ': ' || coalesce(p_error_message, 'Carrier failure'),
          updated_at = now()
      where id = p_message_id;
    else
      -- Permanent failure
      update outbound_messages
      set status = 'failed',
          retry_count = v_msg.retry_count + 1,
          error_code = p_error_code,
          error_message = p_error_message,
          updated_at = now()
      where id = p_message_id;
    end if;

  end if;
end;
$$ language plpgsql;

-- 4. Gateway Device Heartbeat Procedure
create or replace function record_device_heartbeat(
  p_device_id uuid,
  p_battery int,
  p_charging boolean,
  p_network text,
  p_signal int,
  p_app_ver text
) returns void security definer set search_path = public as $$
begin
  update gateway_devices
  set battery_level = p_battery,
      battery_charging = p_charging,
      network_type = p_network,
      signal_strength = p_signal,
      app_version = p_app_ver,
      status = 'online',
      last_heartbeat_at = now(),
      updated_at = now()
  where id = p_device_id;
end;
$$ language plpgsql;

-- 5. Device QR Pairing Procedure
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
declare
  v_session record;
  v_device_id uuid;
begin
  select * into v_session
  from device_pairing_sessions
  where pairing_code = p_pairing_code
    and status = 'pending'
    and expires_at > now();

  if v_session.id is null then
    raise exception 'Invalid or expired pairing code';
  end if;

  -- Create the gateway device record
  insert into gateway_devices (
    organization_id,
    name,
    device_token_hash,
    android_version,
    app_version,
    status,
    last_heartbeat_at
  ) values (
    v_session.organization_id,
    p_device_name,
    p_device_token_hash,
    p_android_ver,
    p_app_ver,
    'online',
    now()
  ) returning id into v_device_id;

  -- Initialize default SIM slots (0 and 1) for the device
  insert into sim_subscriptions (organization_id, device_id, sim_slot, carrier_name, available_balance, status)
  values 
    (v_session.organization_id, v_device_id, 0, 'SIM 1', 0, 'active'),
    (v_session.organization_id, v_device_id, 1, 'SIM 2', 0, 'active')
  on conflict (device_id, sim_slot) do nothing;

  -- Mark pairing session claimed
  update device_pairing_sessions
  set status = 'claimed',
      device_id = v_device_id
  where id = v_session.id;

  return query
  select gd.id, gd.organization_id, org.name
  from gateway_devices gd
  join organizations org on org.id = gd.organization_id
  where gd.id = v_device_id;
end;
$$ language plpgsql;
