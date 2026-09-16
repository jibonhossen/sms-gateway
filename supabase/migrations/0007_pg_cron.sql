-- ==============================================================================
-- 0007_pg_cron.sql
-- All maintenance moves out of hot paths and browsers into scheduled jobs
-- (P1, P2, P12, 1.4, 2.6, 4.2). Requires the pg_cron extension (pre-installed
-- on Supabase projects; enable via Dashboard > Database > Extensions if not).
-- ==============================================================================

create extension if not exists pg_cron;

-- Nightly retention: delivered/failed outbound + dispatched inbound older than
-- 90 days (P12).
create or replace function purge_old_messages()
returns void security definer set search_path = public as $$
begin
  delete from outbound_messages
  where status in ('delivered', 'failed', 'cancelled')
    and created_at < now() - interval '90 days';

  delete from inbound_messages
  where webhook_dispatched_at is not null
    and received_at < now() - interval '90 days';
end;
$$ language plpgsql;

-- Nightly purge of expired pairing sessions (P8)
create or replace function purge_expired_pairing_sessions()
returns void security definer set search_path = public as $$
begin
  delete from device_pairing_sessions
  where expires_at < now() - interval '1 day';
end;
$$ language plpgsql;

-- Hourly rollup of api_key_usage -> last_used_at, then prune the log (P6)
create or replace function rollup_api_key_usage()
returns void security definer set search_path = public as $$
begin
  update api_keys k
  set last_used_at = u.last_used
  from (
    select api_key_id, max(used_at) as last_used
    from api_key_usage
    group by api_key_id
  ) u
  where u.api_key_id = k.id;

  delete from api_key_usage where used_at < now() - interval '7 days';
end;
$$ language plpgsql;

-- -----------------------------------------------------------------------------
-- Schedules
-- -----------------------------------------------------------------------------
select cron.schedule('reset-daily-sim-counters', '*/5 * * * *',
  $$select reset_daily_sim_counters()$$);

select cron.schedule('sweep-expired-leases', '* * * * *',
  $$select sweep_expired_leases()$$);

select cron.schedule('mark-stale-devices-offline', '* * * * *',
  $$select mark_stale_devices_offline()$$);

select cron.schedule('unpin-stale-sim-requests', '15 * * * *',
  $$select unpin_stale_sim_requests()$$);

select cron.schedule('cancel-stuck-messages', '30 * * * *',
  $$select cancel_stuck_messages()$$);

select cron.schedule('purge-old-messages', '0 3 * * *',
  $$select purge_old_messages()$$);

select cron.schedule('purge-expired-pairing-sessions', '0 4 * * *',
  $$select purge_expired_pairing_sessions()$$);

select cron.schedule('purge-webhook-outbox', '0 5 * * *',
  $$select purge_webhook_outbox()$$);

select cron.schedule('rollup-api-key-usage', '0 * * * *',
  $$select rollup_api_key_usage()$$);

-- Webhook outbox retry loop: invokes the dispatch-webhook edge function in
-- "retry_outbox" mode every minute. Requires pg_net (pre-installed on Supabase).
--
-- OPERATOR SETUP (one-time, before running this migration):
--   alter database postgres set "app.settings.supabase_url" = 'https://<project-ref>.supabase.co';
--   alter database postgres set "app.settings.service_role_key" = '<service-role-key>';
-- (Reconnect required for the settings to take effect. Prefer setting these
-- via Supabase Dashboard > Database > Custom Postgres Config, or use the
-- Dashboard's "Scheduled Webhooks" UI instead of embedding the key here.)
create extension if not exists pg_net;

select cron.schedule('dispatch-due-webhooks', '* * * * *',
  $$
  select net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/dispatch-webhook',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := jsonb_build_object('mode', 'retry_outbox'),
    timeout_milliseconds := 25000
  );
  $$);

