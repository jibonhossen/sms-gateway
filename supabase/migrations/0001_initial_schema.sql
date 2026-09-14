-- ==============================================================================
-- 0001_initial_schema.sql: Core Multi-Tenant Schema & Row Level Security
-- ==============================================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- 1. Organizations (Tenants)
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  webhook_url text,
  webhook_secret text not null default encode(gen_random_bytes(32), 'hex'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Organization Members
create table organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  unique(organization_id, user_id)
);

-- 3. Gateway Devices (Android Phones)
create table gateway_devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  device_token_hash text not null unique, -- Hashed secret used by Android app to authenticate
  battery_level int,
  battery_charging boolean default false,
  network_type text, -- 'WIFI', 'CELLULAR_5G', 'CELLULAR_4G', etc.
  signal_strength int, -- Percentage (0-100) or dBm
  app_version text,
  android_version text,
  status text not null default 'offline' check (status in ('online', 'offline', 'disabled')),
  last_heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4. Device Pairing Sessions (10-minute ephemeral QR code tokens)
create table device_pairing_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  pairing_code text not null unique default encode(gen_random_bytes(16), 'hex'),
  status text not null default 'pending' check (status in ('pending', 'claimed', 'expired')),
  device_id uuid references gateway_devices(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  created_at timestamptz not null default now()
);

-- 5. SIM Subscriptions (SIM Slots on Gateway Devices)
create table sim_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  device_id uuid not null references gateway_devices(id) on delete cascade,
  sim_slot int not null default 0 check (sim_slot in (0, 1)),
  carrier_name text,
  phone_number text,
  available_balance int not null default 0, -- Tracked SMS quota
  daily_limit int not null default 200,     -- Safety rate limit per day
  sent_today int not null default 0,
  last_sent_date date not null default current_date,
  expires_at timestamptz,                   -- Quota expiration date (null = indefinite)
  consecutive_failures int not null default 0,
  status text not null default 'active' check (status in ('active', 'quarantined', 'exhausted', 'disabled')),
  quarantined_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(device_id, sim_slot)
);

-- 6. Outbound Messages
create table outbound_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  phone_number text not null,
  message text not null,
  
  -- Target constraints (optional explicit request)
  requested_sim_slot int,
  
  -- Assigned dispatch targets
  device_id uuid references gateway_devices(id) on delete set null,
  sim_subscription_id uuid references sim_subscriptions(id) on delete set null,
  
  -- Lifecycle: pending -> processing -> sent -> delivered / failed
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'delivered', 'failed', 'cancelled')),
  retry_count int not null default 0,
  max_retries int not null default 3,
  error_code int,
  error_message text,
  
  -- Timestamps
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  updated_at timestamptz not null default now()
);

-- 7. Inbound Messages
create table inbound_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  device_id uuid not null references gateway_devices(id) on delete cascade,
  sim_slot int not null default 0,
  sender text not null,
  message text not null,
  received_at timestamptz not null default now(),
  webhook_dispatched_at timestamptz,
  created_at timestamptz not null default now()
);

-- 8. API Keys (For External Applications)
create table api_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  key_prefix text not null, -- e.g. "gw_live_..."
  key_hash text not null unique,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

-- ==============================================================================
-- Indexes for Performance
-- ==============================================================================
create index idx_outbound_queue on outbound_messages(organization_id, status, created_at);
create index idx_outbound_device on outbound_messages(device_id, status);
create index idx_inbound_org on inbound_messages(organization_id, received_at desc);
create index idx_sim_lookup on sim_subscriptions(device_id, status, available_balance, expires_at);
create index idx_gateway_heartbeat on gateway_devices(organization_id, status, last_heartbeat_at);

-- ==============================================================================
-- Supabase Realtime Publication
-- ==============================================================================
alter publication supabase_realtime add table outbound_messages;
alter publication supabase_realtime add table inbound_messages;
alter publication supabase_realtime add table gateway_devices;
alter publication supabase_realtime add table sim_subscriptions;

-- ==============================================================================
-- Row Level Security (RLS)
-- ==============================================================================
alter table organizations enable row level security;
alter table organization_members enable row level security;
alter table gateway_devices enable row level security;
alter table device_pairing_sessions enable row level security;
alter table sim_subscriptions enable row level security;
alter table outbound_messages enable row level security;
alter table inbound_messages enable row level security;
alter table api_keys enable row level security;

-- Helper function: Get organizations accessible by current authenticated user
create or replace function get_user_org_ids()
returns setof uuid security definer set search_path = public stable as $$
  select organization_id from organization_members where user_id = auth.uid();
$$ language sql;

-- RLS Policies
create policy "Members can view their organizations"
  on organizations for select
  using (id in (select get_user_org_ids()));

create policy "Members can update their organizations"
  on organizations for update
  using (id in (select get_user_org_ids()));

create policy "Users can view memberships"
  on organization_members for select
  using (user_id = auth.uid() or organization_id in (select get_user_org_ids()));

create policy "Org members can manage gateway devices"
  on gateway_devices for all
  using (organization_id in (select get_user_org_ids()));

create policy "Org members can manage pairing sessions"
  on device_pairing_sessions for all
  using (organization_id in (select get_user_org_ids()));

create policy "Org members can manage SIM subscriptions"
  on sim_subscriptions for all
  using (organization_id in (select get_user_org_ids()));

create policy "Org members can manage outbound messages"
  on outbound_messages for all
  using (organization_id in (select get_user_org_ids()));

create policy "Org members can view inbound messages"
  on inbound_messages for all
  using (organization_id in (select get_user_org_ids()));

create policy "Devices can insert inbound messages"
  on inbound_messages for insert
  to anon, authenticated
  with check (true);

create policy "Org members can manage API keys"
  on api_keys for all
  using (organization_id in (select get_user_org_ids()));

-- ==============================================================================
-- Auto-create Organization on User Signup
-- ==============================================================================
create or replace function handle_new_user_signup()
returns trigger security definer set search_path = public as $$
declare
  v_org_id uuid;
  v_name text;
begin
  v_name := coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1), 'My Gateway');
  
  insert into organizations (name, slug)
  values (v_name, lower(regexp_replace(v_name, '[^a-zA-Z0-9]', '', 'g')) || '-' || substr(md5(random()::text), 1, 6))
  returning id into v_org_id;

  insert into organization_members (organization_id, user_id, role)
  values (v_org_id, new.id, 'owner');

  return new;
end;
$$ language plpgsql;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user_signup();
