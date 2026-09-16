-- ==============================================================================
-- 0006_webhook_outbox.sql
-- Durable webhook delivery (C5): events are enqueued on failure, retried with
-- backoff, and dead-lettered. Dispatch happens in the edge function; this
-- migration provides the storage and helpers.
-- ==============================================================================

create table if not exists webhook_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  payload jsonb not null,
  attempts int not null default 0,
  max_attempts int not null default 8,
  next_attempt_at timestamptz not null default now(),
  last_status text,
  delivered_at timestamptz,
  dead boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_webhook_outbox_due
  on webhook_outbox(next_attempt_at)
  where delivered_at is null and dead = false;

-- Enqueue an event for (re)delivery.
create or replace function enqueue_webhook_event(
  p_organization_id uuid,
  p_payload jsonb
) returns uuid security definer set search_path = public as $$
declare
  v_id uuid;
begin
  insert into webhook_outbox (organization_id, payload)
  values (p_organization_id, p_payload)
  returning id into v_id;
  return v_id;
end;
$$ language plpgsql;

-- Record a delivery attempt result; schedules exponential backoff on failure.
-- Called by dispatch-webhook after each POST (inline or outbox retry).
create or replace function record_webhook_attempt(
  p_outbox_id uuid,
  p_success boolean,
  p_status_text text
) returns void security definer set search_path = public as $$
declare
  v_attempts int;
  v_max int;
begin
  if p_success then
    update webhook_outbox
    set delivered_at = now(),
        last_status = p_status_text,
        attempts = attempts + 1
    where id = p_outbox_id;
    return;
  end if;

  update webhook_outbox
  set attempts = attempts + 1,
      last_status = p_status_text,
      next_attempt_at = now() + make_interval(
        secs => least(power(coalesce(attempts, 0) + 1, 2) * 30, 3600)
      ),
      dead = (attempts + 1 >= max_attempts)
  where id = p_outbox_id
  returning attempts, max_attempts into v_attempts, v_max;
end;
$$ language plpgsql;

-- Rows due for retry (consumed by the dispatch-webhook retry mode).
create or replace function fetch_due_webhooks(p_limit int default 20)
returns setof webhook_outbox security definer set search_path = public as $$
  select *
  from webhook_outbox
  where delivered_at is null
    and dead = false
    and next_attempt_at <= now()
  order by created_at asc
  limit p_limit
  for update skip locked;
$$ language sql;

-- Retention (scheduled by cron)
create or replace function purge_webhook_outbox()
returns void security definer set search_path = public as $$
begin
  delete from webhook_outbox
  where (delivered_at is not null and delivered_at < now() - interval '7 days')
     or (dead = true and created_at < now() - interval '30 days');
end;
$$ language plpgsql;
