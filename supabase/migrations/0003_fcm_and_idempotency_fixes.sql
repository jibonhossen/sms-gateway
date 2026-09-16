-- ==============================================================================
-- 0003_fcm_and_idempotency_fixes.sql: FCM Wakeup Tokens, Idempotent Quota & Resilient Quarantine
-- ==============================================================================

-- 1. Add FCM push token column to gateway devices
alter table gateway_devices add column if not exists fcm_token text;

-- 2. Procedure to record and update device FCM token
create or replace function record_device_fcm_token(
  p_device_id uuid,
  p_fcm_token text
) returns void security definer set search_path = public as $$
begin
  update gateway_devices
  set fcm_token = p_fcm_token,
      updated_at = now()
  where id = p_device_id;
end;
$$ language plpgsql;

-- 3. Resilient & Idempotent Report SMS Result
create or replace function report_sms_result(
  p_message_id uuid,
  p_device_id uuid,
  p_status text, -- 'sent', 'delivered', 'failed'
  p_error_code int default null,
  p_error_message text default null
) returns void security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_msg record;
  v_sim_id uuid;
  v_failures int;
  v_is_carrier_error boolean;
begin
  select * into v_msg
  from outbound_messages
  where id = p_message_id;

  if v_msg.id is null then
    return;
  end if;

  v_sim_id := v_msg.sim_subscription_id;

  if p_status = 'sent' then
    -- IDEMPOTENCY GUARD: Only decrement balance once when moving from processing -> sent
    if v_msg.status = 'processing' then
      update outbound_messages
      set status = 'sent',
          sent_at = coalesce(sent_at, now()),
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
        updated_at = now()
    where id = p_message_id;

  elsif p_status = 'failed' then
    -- Distinguish cellular carrier/radio error vs destination validation error
    -- Result error codes from Android SmsManager:
    -- 1 = RESULT_ERROR_GENERIC_FAILURE, 2 = RESULT_ERROR_RADIO_OFF, 3 = RESULT_ERROR_NULL_PDU, 4 = RESULT_ERROR_NO_SERVICE
    v_is_carrier_error := p_error_code in (1, 2, 3, 4) or p_error_code is null;

    if v_sim_id is not null and v_is_carrier_error then
      update sim_subscriptions
      set consecutive_failures = consecutive_failures + 1,
          updated_at = now()
      where id = v_sim_id
      returning consecutive_failures into v_failures;

      -- Auto-Quarantine: 3 consecutive carrier failures isolates the SIM
      if v_failures >= 3 then
        update sim_subscriptions
        set status = 'quarantined',
            quarantined_reason = coalesce(p_error_message, 'Auto-quarantined: 3 consecutive carrier radio failures'),
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
          error_message = 'Failover attempt ' || (v_msg.retry_count + 1) || ': ' || coalesce(p_error_message, 'Transmission error'),
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

-- 4. Mark stale devices offline if no heartbeat for > 2 minutes
create or replace function mark_stale_devices_offline()
returns void security definer set search_path = public as $$
begin
  update gateway_devices
  set status = 'offline',
      updated_at = now()
  where status = 'online'
    and (last_heartbeat_at is null or last_heartbeat_at < now() - interval '2 minutes');
end;
$$ language plpgsql;
