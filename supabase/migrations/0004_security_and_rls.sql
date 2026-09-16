-- ==============================================================================
-- 0004_security_and_rls.sql
-- Device authentication on every device-side RPC (C2), role-based RLS (H5),
-- inbound dedupe (P10/H6), API key lifecycle + rate limiting (P6).
--
-- BREAKING: device RPCs now require a valid p_device_token. Ship together with
-- the matching Android release that persists and sends the token.
-- ==============================================================================

-- -----------------------------------------------------------------------------
-- 1. Device verification helper
-- -----------------------------------------------------------------------------
create or replace function verify_device_auth(
  p_device_id uuid,
  p_device_token text
) returns void security definer set search_path = public as $$
begin
  if p_device_id is null or p_device_token is null then
    raise exception 'UNAUTHORIZED_DEVICE';
  end if;
  if not exists (
    select 1 from gateway_devices
    where id = p_device_id
      and device_token_hash = encode(digest(p_device_token, 'sha256'), 'hex')
      and status <> 'disabled'
  ) then
    raise exception 'UNAUTHORIZED_DEVICE';
  end if;
end;
$$ language plpgsql;

-- -----------------------------------------------------------------------------
-- 2. Inbound message dedupe + device-gated insert (H6, P10)
-- -----------------------------------------------------------------------------
alter table inbound_messages add column if not exists idem_key text;

-- Replaces the wide-open "with check (true)" policy. Devices insert exclusively
-- through record_inbound_sms() (SECURITY DEFINER, token verified).
drop policy if exists "Devices can insert inbound messages" on inbound_messages;

create or replace function record_inbound_sms(
  p_device_id uuid,
  p_device_token text,
  p_sender text,
  p_message text,
  p_sim_slot int,
  p_idem_key text
) returns void security definer set search_path = public as $$
declare
  v_org_id uuid;
begin
  perform verify_device_auth(p_device_id, p_device_token);

  select organization_id into v_org_id from gateway_devices where id = p_device_id;
  if v_org_id is null then
    return;
  end if;

  insert into inbound_messages (organization_id, device_id, sim_slot, sender, message, idem_key)
  values (v_org_id, p_device_id, coalesce(p_sim_slot, 0), p_sender, p_message, p_idem_key)
  on conflict do nothing;
end;
$$ language plpgsql;

-- Unique dedupe at the DB level (idem_key is sha256 of sender|body|slot|minute)
create unique index if not exists uq_inbound_dedupe
  on inbound_messages(organization_id, device_id, idem_key)
  where idem_key is not null;

-- -----------------------------------------------------------------------------
-- 3. Device-side RPCs now require the device token
-- -----------------------------------------------------------------------------

-- 3a. FCM token sync
create or replace function record_device_fcm_token(
  p_device_id uuid,
  p_device_token text,
  p_fcm_token text
) returns void security definer set search_path = public as $$
begin
  perform verify_device_auth(p_device_id, p_device_token);
  update gateway_devices
  set fcm_token = p_fcm_token,
      updated_at = now()
  where id = p_device_id;
end;
$$ language plpgsql;

-- 3b. Heartbeat (also extends active message leases — see 0005)
create or replace function record_device_heartbeat(
  p_device_id uuid,
  p_device_token text,
  p_battery int,
  p_charging boolean,
  p_network text,
  p_signal int,
  p_app_ver text,
  p_active_drain boolean default false
) returns void security definer set search_path = public as $$
begin
  perform verify_device_auth(p_device_id, p_device_token);

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

  -- Lease renewal: while the device is actively draining, keep its claimed
  -- messages from being re-claimed by another device (C4).
  if p_active_drain then
    update outbound_messages
    set lease_expires_at = now() + interval '15 minutes',
        updated_at = now()
    where device_id = p_device_id
      and status = 'processing';
  end if;
end;
$$ language plpgsql;

-- -----------------------------------------------------------------------------
-- 4. Role-based RLS (H5)
-- -----------------------------------------------------------------------------
create or replace function is_org_admin(p_org uuid)
returns boolean security definer set search_path = public stable as $$
  exists (
    select 1 from organization_members
    where organization_id = p_org
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$ language sql;

-- Organizations: only owners/admins may update (webhook_url, webhook_secret…)
drop policy if exists "Members can update their organizations" on organizations;
create policy "Admins can update their organizations"
  on organizations for update
  using (is_org_admin(id))
  with check (is_org_admin(id));

-- Webhook secret must not be updatable by plain members; select stays for members.

-- API keys: admin-only management, member read
drop policy if exists "Org members can manage API keys" on api_keys;
create policy "Org admins can manage API keys"
  on api_keys for all
  using (is_org_admin(organization_id))
  with check (is_org_admin(organization_id));
create policy "Org members can view API keys"
  on api_keys for select
  using (organization_id in (select get_user_org_ids()));

-- SIM subscriptions: members read; admins mutate
drop policy if exists "Org members can manage SIM subscriptions" on sim_subscriptions;
create policy "Org members can view SIM subscriptions"
  on sim_subscriptions for select
  using (organization_id in (select get_user_org_ids()));
create policy "Org admins can manage SIM subscriptions"
  on sim_subscriptions for all
  using (is_org_admin(organization_id))
  with check (is_org_admin(organization_id));

-- -----------------------------------------------------------------------------
-- 5. API key lifecycle + rate limiting (P6)
-- -----------------------------------------------------------------------------
alter table api_keys
  add column if not exists revoked_at timestamptz,
  add column if not exists expires_at timestamptz;

create table if not exists api_key_rate_limits (
  api_key_id uuid not null references api_keys(id) on delete cascade,
  window_start timestamptz not null,
  request_count bigint not null default 0,
  primary key (api_key_id, window_start)
);

create table if not exists api_key_usage (
  api_key_id uuid not null references api_keys(id) on delete cascade,
  used_at timestamptz not null default now()
);
create index if not exists idx_api_key_usage_key on api_key_usage(api_key_id, used_at);

-- Fixed-window rate limiter; returns true when the request is allowed.
create or replace function check_api_key_rate_limit(
  p_key_id uuid,
  p_limit bigint
) returns boolean security definer set search_path = public as $$
declare
  v_count bigint;
begin
  insert into api_key_rate_limits (api_key_id, window_start, request_count)
  values (p_key_id, date_trunc('minute', now()), 1)
  on conflict (api_key_id, window_start)
  do update set request_count = api_key_rate_limits.request_count + 1
  returning request_count into v_count;

  return v_count <= p_limit;
end;
$$ language plpgsql;

-- Log a usage hit (replaces the per-request last_used_at UPDATE; rolled up by cron)
create or replace function log_api_key_usage(p_key_id uuid)
returns void security definer set search_path = public as $$
begin
  insert into api_key_usage (api_key_id) values (p_key_id);
end;
$$ language plpgsql;

-- -----------------------------------------------------------------------------
-- 6. Per-tenant quota reset timezone (P7)
-- -----------------------------------------------------------------------------
alter table organizations add column if not exists quota_reset_tz text not null default 'UTC';

-- Rate-limit counter lives beside the other daily counters (also declared in
-- 0005 for idempotency; kept here so this file is self-contained).
alter table sim_subscriptions add column if not exists rate_limited_today int not null default 0;

-- Timezone-aware daily reset (replaces the naive UTC version; scheduled by cron)
create or replace function reset_daily_sim_counters()
returns void security definer set search_path = public as $$
begin
  update sim_subscriptions s
  set sent_today = 0,
      rate_limited_today = 0,
      last_sent_date = ((now() at time zone coalesce(o.quota_reset_tz, 'UTC'))::date),
      updated_at = now()
  from organizations o
  where o.id = s.organization_id
    and s.last_sent_date < ((now() at time zone coalesce(o.quota_reset_tz, 'UTC'))::date);
end;
$$ language plpgsql;

