# System Analysis Report — SMS Gateway

**Scope:** Full review of the Supabase control plane (`/supabase`), the Next.js dashboard (`/web`), and the Android gateway client (`/android`).
**Focus:** Edge cases, correctness bugs, performance problems, and scalability limits.
**Severity scale:** 🔴 Critical · 🟠 High · 🟡 Medium · 🔵 Low

---

## 1. Architecture Summary

- **Control plane:** PostgreSQL + RLS, `SECURITY DEFINER` RPCs (`claim_next_sms`, `report_sms_result`, heartbeats, pairing), Supabase Realtime for wake-ups, Edge Functions for the public REST API and HMAC webhooks.
- **Dispatch loop:** Devices poll `claim_next_sms` every 10 s, paced at 2 s/message; FCM high-priority pushes act as out-of-band wake-ups; delivery receipts flow back through `SmsStatusReceiver`.
- **Dashboard:** Client-side Supabase queries with Realtime-triggered refetches.

---

## 2. Critical Findings

### 🔴 C1. `/api/messages/send` has no authentication and breaks multi-tenancy
`web/app/api/messages/send/route.ts`
- The middleware exempts `/api` from redirects (`web/lib/supabase/middleware.ts` lines 50–52), and the route itself **never calls `auth.getUser()`**.
- It resolves the tenant with `select("id").limit(1)` on `organizations` — i.e. **whichever organization sorts first in the whole database** — then inserts with `SUPABASE_SERVICE_ROLE_KEY` (or falls back to the anon key).
- Consequence: **any unauthenticated caller** can queue SMS as the first tenant, and every dashboard user posts into that same tenant regardless of their membership.

**Fix:** Require an authenticated session, resolve the org from `organization_members` for that user (or accept an explicit `organizationId` verified via `get_user_org_ids()`), and validate the body (E.164 phone, message length, `requested_sim_slot ∈ {0,1}`).

### 🔴 C2. Devices are never authenticated — `device_token_hash` is stored but never verified
`complete_device_pairing` stores a hashed device token, but every device-side RPC — `claim_next_sms`, `report_sms_result`, `record_device_heartbeat`, `record_device_fcm_token` — accepts a **bare `p_device_id`** and is `SECURITY DEFINER`, executable by `anon`/`public`.
- Anyone with the anon key who learns a `device_id` (UUIDs leak through logs, dashboards, `inbound_messages.device_id`…) can:
  - **read queued messages** (recipient + full body) via `claim_next_sms`,
  - mark messages sent/failed (poisoning failover and quarantine logic),
  - drain SIM balances and spoof telemetry.

**Fix:** Pass the device token to every RPC and verify its hash inside the function (or issue each device a Supabase JWT scoped to its org).

### 🔴 C3. Realtime wake-up can never deliver events to devices (RLS blocks anon)
`SupabaseManager.subscribeToQueue` subscribes with the **anon** client to `postgres_changes` on `outbound_messages`. The only RLS policy on that table requires `organization_id ∈ get_user_org_ids()` — which is empty for the anon role — and **Supabase Realtime applies RLS to `postgres_changes`**. Devices therefore receive **zero** events; the realtime path is decorative and the system silently relies on the 10 s heartbeat polling (and FCM, where configured).

**Fix:** Give devices real identities (per-device JWT) so RLS passes, or replace postgres_changes with an RPC-based wakeup/short poll.

### 🔴 C4. 2-minute orphan recovery causes duplicate SMS and unbounded redelivery
`claim_next_sms` resets any `processing` message older than **2 minutes** back to `pending` — but:
- The device claims messages and sends them **sequentially with 2 s pacing** (`SmsDispatcher.delay(2000)`), and receipts are reported asynchronously. A backlog of ~60 messages, a slow network, or an FCM drain racing the foreground-service drain keeps claimed messages in `processing` well beyond 2 minutes → **a second device re-claims and the SMS is sent twice**.
- Orphan recovery does **not** increment `retry_count`, so a device that claims-then-dies repeatedly redelivers the same message **forever**.

**Fix:** Lease model — device renews `processed_at` while alive (heartbeat carries the lease), set the window above worst-case send time, and count orphan recovery as a retry toward `max_retries`.

### 🔴 C5. Webhook dispatch loses events, has no retry, and is an SSRF vector
`supabase/functions/dispatch-webhook/index.ts`
- `webhook_dispatched_at` is written **even when the POST fails** (`response.ok` is never checked) → permanent event loss for tenants.
- No retry/backoff, no dead-letter, no timeout tuning.
- `webhook_url` is tenant-controlled and the function POSTs to it from a trusted environment → **SSRF** (internal services, cloud metadata endpoints).
- Fires per row-change with no dedup/batching: one outbound message generates up to ~4 webhook calls (insert/sent/delivered/status updates); inbound bursts create thundering-herd POSTs to tenant endpoints.

**Fix:** Check `response.ok`, retry with exponential backoff (pg_cron sweep of `webhook_dispatched_at IS NULL`), validate URL schemes and block private IP ranges, batch events.

---

## 3. High Findings

### 🟠 H1. Multipart SMS: per-part broadcasts corrupt message state
`SmsDispatcher.sendSms` reuses the **same `PendingIntent` (same requestCode = `messageId.hashCode()`)** for every part of a multipart message. The SENT broadcast fires once per part:
- Part 1 success → `sent` (balance decremented once — the idempotency guard holds).
- Part 2 failure → `report_sms_result("failed")` on a message already in `sent` → failover re-queues and **the whole message is resent while parts of it were already delivered** → duplicates + double balance deduction.
- `messageId.hashCode()` collisions can also overwrite another message's PendingIntent.

**Fix:** Unique requestCode per part, aggregate part results, report a single terminal result per message.

### 🟠 H2. Silent SIM fallback mis-attributes traffic
`getSmsManagerForSlot` falls back to the **default** SmsManager when the requested slot has no active subscription. The server already recorded `sim_subscription_id` for the requested SIM, so balance / `sent_today` / failure counters are mutated on a SIM that didn't send, and the message leaves via whatever the default SIM is (wrong sender ID, wrong quota pool, possible `daily_limit` breach).

**Fix:** Report a failure (`wrong SIM / no subscription`) instead of silently re-routing; make the server the single source of truth for SIM attribution.

### 🟠 H3. FCM handler blocks the main thread → ANR / process kill
`GatewayFirebaseMessagingService.onMessageReceived` runs `runBlocking(Dispatchers.IO)` for the entire drain (2 s pacing × N messages) **on the main thread**. Beyond ~10 s this ANRs and FCM may kill the process, leaving claimed messages stuck in `processing` — feeding C4 duplicates. The 30 s wakelock can also expire while `while (isActive)` (effectively unbounded inside `runBlocking`) is still draining. It also starts `SmsGatewayService` concurrently, so two drains race.

**Fix:** Use a coroutine launched from `goAsync()`/a foreground service with a bounded batch size per wake-up.

### 🟠 H4. Concurrent drains defeat pacing and trip auto-quarantine
The foreground-service heartbeat loop, the FCM drain, and the network-callback drain can run **in parallel** (`isQueueProcessing` is a non-synchronized check-then-act flag). Two loops pacing independently produce a combined ~1 msg/s → Android's `RESULT_ERROR_LIMIT_EXCEEDED` / carrier throttling → 3 "consecutive failures" → **a healthy SIM gets auto-quarantined** (the ADR-0003 heuristic can't distinguish self-inflicted rate limiting from real carrier faults).

**Fix:** Single serialized drain actor (Mutex/Channel), shared pacing token bucket, and exclude OS rate-limit errors from the quarantine counter.

### 🟠 H5. RLS lets any `member` hijack the organization
The `organizations` UPDATE policy checks membership only, not role. A `member` can change `webhook_url` and `webhook_secret` (redirect all tenant events, learn the signing secret) and can also manage devices, SIMs, and API keys. No role-differentiated `with check` policies exist.

**Fix:** Restrict `update` on organizations (and `all` on `api_keys`, `sim_subscriptions`) to `owner`/`admin` via a role-aware helper function.

### 🟠 H6. Anonymous inserts into `inbound_messages` (`with check (true)`)
Anyone with the public anon key can forge inbound rows for **any** organization (org_id is client-supplied), which fans out `sms.received` webhooks to tenant endpoints — spam/DoS of tenant webhooks and poisoned inboxes.

**Fix:** Gate inserts behind device authentication (C2) with `with check (device belongs to caller)`.

### 🟠 H7. Unvalidated inputs create stuck messages and cost blowouts
- Neither the edge function nor the web API validates phone format or message length. A multi-KB "message" → hundreds of multipart segments → rate-limit failures and cost blowouts (`divideMessage` can also throw).
- `requested_sim_slot` is not constrained to `{0,1}` (no CHECK constraint on `outbound_messages` either). Any other value makes the message **permanently un-claimable** — `claim_next_sms` filters on `requested_sim_slot = v_sim.sim_slot`, so it sits pending forever with no timeout or alert.

**Fix:** Validate at both entry points; add `CHECK (requested_sim_slot IN (0,1))`; add a stuck-message sweeper.

---



## 4. Performance & Scalability Findings

### 🟡 P1. `claim_next_sms` performs global table writes on every poll
Every claim (per device, every 10 s) runs:
- `reset_daily_sim_counters()` — UPDATE over **all** `sim_subscriptions` with `last_sent_date < current_date`; **no index on `last_sent_date`** → sequential scan per call.
- A global orphan-reset UPDATE on `status='processing'` — **no partial index** on that predicate.

At 50–100 devices that's thousands of full-table scans per hour plus row-lock contention with `report_sms_result`. **Fix:** pg_cron for both jobs; scope orphan recovery to the calling device's org; add partial indexes.

### 🟡 P2. Telemetry is fabricated and offline detection depends on dashboard traffic
The service hardcodes `networkType="WIFI/CELLULAR"`, `signalStrength=100`, `appVersion="1.0.0"` — the dashboard's telemetry shows garbage. `mark_stale_devices_offline` is only invoked from the browser overview page: with no dashboard open, dead devices stay `online` forever and FCM fan-out keeps hitting stale tokens. **Fix:** pg_cron; read real `TelephonyManager`/`BuildConfig` values.

### 🟡 P3. Realtime channel leak on Android
`startRealtimeListener()` runs from `onStartCommand` **and** every `onAvailable` network callback. Each call creates a new `gateway_queue` channel without removing the previous one → duplicate events and a wakeup storm after network flaps. `subscribeToQueue` has no dedupe/unsubscribe. **Fix:** keep one channel; remove/re-subscribe idempotently.

### 🟡 P4. Dashboard fetch storm
`web/app/page.tsx` refetches 3 queries (including **500 full message rows**) on **every** realtime event of **any** of the 3 tables, plus a 5 s re-render tick, with `setLoading(true)` flicker. N dashboards × M events/min = O(N×M) full refetches. Inbox/outbound pages repeat the pattern with hard `limit(100/500)` and no pagination or keyset ordering. **Fix:** debounce + targeted state updates from event payloads; server-side pagination.

### 🟡 P5. FCM TTL 24 h defeats the wake-up purpose; no token lifecycle
`ttl: "86400s"` on a "high-priority wake-up" means the drain can fire **a day later** — long after orphan recovery (C4) has already resent the message. No `collapse_key`, no handling of `UNREGISTERED`/`INVALID_ARGUMENT` responses to prune dead `fcm_token`s, and fan-out targets **all** org devices including offline ones. **Fix:** TTL of a few seconds, collapse key, token pruning on send failure.

### 🟡 P6. Public API writes `last_used_at` on every request + unsalted fast hash
An extra row UPDATE per API call (hot-row contention on a busy key) and SHA-256 without salt/pepper (safe only if keys are very high-entropy). No revocation/expiry column, no per-key rate limiting. **Fix:** batch `last_used_at` updates; add `revoked_at`/`expires_at`; rate-limit per key.

### 🟡 P7. Quota day boundary is UTC
`last_sent_date < current_date` uses the DB timezone → quotas reset at UTC midnight, misaligned with local/carrier billing days for non-UTC tenants.

### 🟡 P8. Pairing race + unbounded session table
`complete_device_pairing` does SELECT-then-UPDATE on the pairing session without `FOR UPDATE` → two concurrent scans of the same QR create two devices. Expired pairing sessions are never purged.

### 🟡 P9. Fire-and-forget coroutines in broadcast receivers
`SmsStatusReceiver` / `SmsIncomingReceiver` launch unscoped coroutines without `goAsync()`. The process can die before the network call lands: lost delivery receipts (stuck `processing` → C4 duplicates) and lost inbound SMS. No on-device retry/outbox. **Fix:** `goAsync()` + a local persistent outbox.

### 🟡 P10. No inbound dedupe
SMSC redeliveries / app restarts create duplicate `inbound_messages` rows and duplicate webhooks. Add an idempotency key (hash of sender+body+slot+timestamp window) with a unique index.

### 🟡 P11. Indefinite wakelock
`acquire()` with no timeout held for the service's lifetime — battery drain, Doze non-compliance, Play-Vitals/policy risk. Use a timeout + re-acquire pattern; the foreground service alone may suffice.

### 🔵 P12. Unbounded data growth & housekeeping
`outbound_messages`/`inbound_messages` have no retention/partitioning; the dashboard repeatedly pulls full rows (including message bodies). No cleanup for expired pairing sessions, and quarantined SIMs have no auto-revival path (operator action only, undocumented).

### 🔵 P13. Misc
- `middleware.ts` runs `auth.getUser()` on every request including `/api` routes that don't need it.
- No tests, no CI; edge functions pin `deno/std@0.177.0` (old) and build a new service client per invocation.
- `ActivityLogManager` list mutations are not synchronized across coroutines (UI-level races).
- `webhook_secret` stored plaintext in `organizations`.

---

## 5. Duplicate-SMS Failure Chain (worked example)

1. API queues 100 messages (C1 bypasses auth entirely).
2. Device A claims msg #1, holds `processing`; its drain queue is long (2 s pacing) → >2 min.
3. `claim_next_sms` orphan-reset returns msg #1 to `pending` (no retry increment).
4. Device B (or the FCM drain) claims it → **duplicate SMS #1**.
5. Meanwhile Device A's part-2 receipt fails (H1) → re-queue → **third copy**.
6. Parallel drains (H4) trip `RESULT_ERROR_LIMIT_EXCEEDED` → healthy SIM auto-quarantined.
7. Tenant webhook for each state change fires; endpoint is down → event lost forever (C5).

Each stage is independently fixable; together they make duplicates, quarantine flapping, and data loss near-certain under load.

---

## 6. Prioritized Remediation Plan

| Priority | Item | Effort |
|---|---|---|
| 1 | C1: Auth + tenant resolution in `/api/messages/send` | S |
| 2 | C2: Verify device token inside every RPC | M |
| 3 | C4/H1/H3: Lease model, per-part PendingIntent handling, non-blocking FCM drain | M |
| 4 | C5: Webhook success-check, retry, SSRF guard | M |
| 5 | H5/H6: Role-based RLS; close anon inbound insert | S |
| 6 | H7: Input validation + `requested_sim_slot` CHECK constraint | S |
| 7 | P1/P2: pg_cron for quota reset, orphan sweep, stale devices; partial indexes | M |
| 8 | P3/P4/P5: channel dedupe, dashboard debounce, FCM TTL + token pruning | S–M |

*Effort: S ≤ 1 day, M ≤ 1 week.*

