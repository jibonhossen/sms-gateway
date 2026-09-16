# Remediation Plan — SMS Gateway

> **STATUS: IMPLEMENTED (2026-09-16).** All phases below have been implemented in this branch.
> Migration files were consolidated as: `0004_security_and_rls.sql` (Phases 1.2/1.3/4.1–4.3),
> `0005_lease_and_queue.sql` (Phase 2.1–2.8, 4.4), `0006_webhook_outbox.sql` (Phase 1.4),
> `0007_pg_cron.sql` (Phases 3.2, 4.2, 4.6 retention).
> One documented deviation: Phase 3.1 was implemented via the *fallback* option —
> realtime **broadcast** channels (`gateway_queue:<orgId>`) instead of per-device
> JWT auth users, since broadcast events are not RLS-filtered and require no
> pairing-flow changes. Per-device JWTs remain an optional future hardening.

Companion to `docs/SYSTEM_ANALYSIS_REPORT.md` (C1–C5, H1–H7, P1–P13).
Plan is organized into 5 phases. **Order matters**: Phase 1 closes the open doors before Phase 2 rewrites delivery logic; DB migrations are numbered `0004`–`0012` and must stay backward-compatible for one release (two-phase rollout) so in-flight Android clients don't break.

**Rollout rule:** every DB change lands as *additive* first (optional params, new columns, new functions), then a *cutover* migration flips behavior once the Android app version requiring it is mandatory. *Implementation note: device-token enforcement is immediate — the Android app and migrations ship together in this branch; re-pair any already-paired device so it stores its token.*

---

## Phase 0 — Safety net (0.5 day)

| Step | Change | Files |
|---|---|---|
| 0.1 | Add CI: `pnpm typecheck && pnpm build` for `/web`; Gradle `assembleDebug` + unit tests for `/android`; `supabase db lint` | `.github/workflows/ci.yml` |
| 0.2 | Stand up local Supabase (`supabase start`) + seed script so migrations and RPCs can be tested against Postgres 15 locally before deploy | `supabase/seed.sql`, `supabase/config.toml` |
| 0.3 | Add integration test harness for RPCs: claim/report/heartbeat/pairing happy paths + adversarial cases (wrong token, wrong org, replayed pairing code) | `supabase/tests/*.sql` (pgTAP or plain psql asserts) |
| 0.4 | First migration `0004_indexes.sql`: `create index ... on outbound_messages(processed_at) where status='processing';` and index on `sim_subscriptions(last_sent_date)`; `revoke execute` audit of all functions | `supabase/migrations/0004_indexes.sql` |

**Exit criteria:** CI green, local stack reproducible, adversarial RPC tests captured (they fail today — that's the baseline proving Phase 1).

---

## Phase 1 — Close the open doors (security) (~3 days)

### 1.1 Fix `/api/messages/send` → fixes **C1**, part of **H7**
`web/app/api/messages/send/route.ts`
1. Call `createServerClient` from `@/lib/supabase/server` with cookies → `auth.getUser()`; return `401` when missing.
2. Resolve tenant from membership: `select organization_id from organization_members where user_id = …` (never `organizations.limit(1)`). Optionally accept `organizationId` in body, verified against membership.
3. Use the **user-scoped** client for the insert (RLS applies) — drop the service-role fallback entirely.
4. Validate input: E.164 regex `^\+[1-9]\d{6,14}$`, message 1–1600 chars, `requestedSimSlot ∈ {0,1} | null`. Reject with 400.
5. Keep the FCM fan-out (Phase 3 changes its contents).

### 1.2 Device authentication on every RPC → fixes **C2**, **H6**
New migration `0005_device_auth.sql` + Android changes.
1. Pairing already generates a token on the device and stores `device_token_hash`. Persist the **plain token** in `GatewayApp` prefs (verify `OnboardingActivity`/`QrScanActivity` keep it — if only the hash is stored today, generate the token on the device, send only the hash at pairing, and keep the plain token local; it never travels again).
2. Add `p_device_token text` parameter to `claim_next_sms`, `report_sms_result`, `record_device_heartbeat`, `record_device_fcm_token`, and a new `record_inbound_sms` RPC. Each function starts with:
   ```sql
   if p_device_token is null or not exists (
     select 1 from gateway_devices
     where id = p_device_id
       and device_token_hash = encode(digest(p_device_token, 'sha256'), 'hex')
       and status <> 'disabled'
   ) then raise exception 'UNAUTHORIZED_DEVICE'; end if;
   ```
   Keep the param optional for one release (default null → old behavior + `log` warning), then cutover `0008_enforce_device_auth.sql` to raise when null.
3. **Inbound:** create `record_inbound_sms(p_device_id, p_device_token, sender, message, sim_slot, p_idem_key)` (SECURITY DEFINER, dedupe via unique `idem_key`, see 2.7). Drop the `with check (true)` insert policy on `inbound_messages`; devices insert only through the RPC. → fixes **H6**.
4. Android `SupabaseManager`: every RPC call passes `p_device_token` from prefs.

### 1.3 Role-based RLS → fixes **H5**
`0006_role_rls.sql`
1. `create function is_org_admin(p_org uuid) returns boolean security definer` → `exists(select 1 from organization_members where organization_id=p_org and user_id=auth.uid() and role in ('owner','admin'))`.
2. Replace policies:
   - `organizations update` → `using (is_org_admin(id)) with check (is_org_admin(id))`.
   - `api_keys all`, `sim_subscriptions update/delete` → admin-only; keep `select` for members.
   - `gateway_devices`: select/update for members, delete admin-only.
3. Dashboard pages that mutate devices/SIMs: surface 403 errors instead of failing silently.

### 1.4 Harden `dispatch-webhook` → fixes **C5**
`supabase/functions/dispatch-webhook/index.ts` + `0007_webhook_outbox.sql`
1. Add `webhook_outbox` table (`id, organization_id, payload jsonb, attempts int, next_attempt_at, delivered_at, last_status`). Edge function *enqueues* instead of sending inline (or, minimal version: only mark `webhook_dispatched_at` when `response.ok`).
2. `pg_cron` every minute: due rows → POST with **`AbortSignal.timeout(10_000)`**; on failure backoff `attempts^2 * 30s`, max 8 attempts → `dead` flag surfaced in dashboard.
3. SSRF guard before fetch: allow only `https://`, resolve host and reject private/loopback/link-local ranges (and cloud metadata IPs `169.254.169.254` etc.). Reject http:// entirely.
4. Batch: one webhook per message-status transition, not per row UPDATE — filter payload types (`INSERT` + final statuses) inside the function.

**Exit criteria:** unauthenticated POST to `/api/messages/send` → 401; RPCs without token → `UNAUTHORIZED_DEVICE`; `member` cannot update org; failed webhook retried with backoff; local pgTAP adversarial tests pass.

---

## Phase 2 — Delivery correctness (no more lost/duplicated SMS) (~4 days)

### 2.1 Lease-based claim instead of 2-minute orphan reset → fixes **C4**
`0008_lease_model.sql` (includes 1.2 cutover)
1. `outbound_messages`: add `lease_expires_at timestamptz`. `claim_next_sms` sets `status='processing', lease_expires_at = now() + interval '15 minutes'`.
2. `record_device_heartbeat` gains `p_has_lease boolean` semantics: when the device reports an active drain, extend leases it holds: `update outbound_messages set lease_expires_at = now() + interval '15 minutes' where device_id = p_device_id and status='processing'`.
3. Orphan sweep becomes a **pg_cron job** (not in the claim hot path): reclaim rows where `status='processing' and lease_expires_at < now()` → set `pending`, `retry_count = retry_count + 1`, and mark `failed` when `retry_count >= max_retries` (kills the infinite-redelivery loop).
4. Remove the in-claim global reset entirely (also fixes the P1 hot-path writes).

### 2.2 Per-part PendingIntents + aggregated receipts → fixes **H1**
`android/.../SmsDispatcher.kt` + `SmsStatusReceiver.kt` + `Models.kt`
1. requestCode = stable `messageId.hashCode() + partIndex * 31`; put `part_index` and `part_count` extras in the intent (data URI already carries messageId).
2. Track part results in a small in-memory `MessageReceiptAggregator` (object, keyed by messageId, `Array<Boolean>(partCount)`): SENT broadcast resolves one slot. Only when **all** parts resolved → report single terminal result (`sent` if all OK, `failed` with first error otherwise). Timeout the aggregator after 60 s → report failure (receiver may have died).
3. Failure of *any* part = whole message failed; do **not** re-queue automatically from the device (server failover decides) — this prevents resending half-delivered messages.
4. Also fixes the `hashCode()` collision window since requestCode now includes partIndex and a message-scoped salt.

### 2.3 Fail loudly instead of silent SIM fallback → fixes **H2**
`SmsDispatcher.getSmsManagerForSlot`: when `simSlot != null` and no matching active subscription → report `failed` (new error code, e.g. `9001 "Requested SIM slot not active"`) and skip sending. Never fall back to the default SIM for a slot-pinned message. Keep default-manager path only for `simSlot == null`.

### 2.4 Non-blocking FCM drain with bounded batch → fixes **H3**, half of **H4**
`GatewayFirebaseMessagingService.kt`
1. Replace `runBlocking` with `goAsync()` + `CoroutineScope(Dispatchers.IO)`; `pendingResult.finish()` in `finally`.
2. Bound the batch: max **10** messages per FCM wake-up; anything remaining stays queued (heartbeat loop or next wake-up drains it). Remove `SmsGatewayService.start()` from the FCM path on API 31+ (background FGS-start restriction) — only attempt on `API < 31`.
3. WakeLock: acquire per-batch with the 30 s timeout (sized to the 10-message bound: 10 × 2 s + slack).

### 2.5 Single drain actor + pacing + rate-limit-aware quarantine → fixes **H4**
`SmsGatewayService.kt`, `SmsDispatcher.kt`, `0009_quarantine_fix.sql`
1. Move all draining behind one `Mutex` (or a `Channel<Unit>` wakeup signal): FCM, network callback, heartbeat, and realtime all `send` to the same signal; a single consumer loop drains. Delete the `isQueueProcessing` flag.
2. Pacing: token bucket shared across both entry paths — first message sends immediately (drop the unconditional leading `delay(2000)`), then 2 s between messages measured from last actual send.
3. Migration: `report_sms_result` — when `p_error_code = RESULT_ERROR_LIMIT_EXCEEDED` (5) or OS rate-limit codes, increment a new `rate_limited_today` counter instead of `consecutive_failures`; do not quarantine. Reset `rate_limited_today` in the daily reset job.

### 2.6 Input validation + stuck-message guard → fixes **H7**
1. Edge function `send-sms`: same validation as 1.1.4 (E.164, ≤1600 chars, sim_slot 0/1) plus message-length→part estimate; return 422 on violation. Also stop the per-request `last_used_at` write (see 4.2).
2. Migration `0010_constraints.sql`: `alter table outbound_messages add constraint chk_sim_slot check (requested_sim_slot is null or requested_sim_slot in (0,1)) not valid;` then `validate constraint` (existing bad rows updated to null first).
3. pg_cron sweeper: `pending` older than 24 h → `cancelled` with `error_message='queue timeout'` (also covers 2.1 dead-lease tail).

### 2.7 Receiver reliability + inbound dedupe → fixes **P9**, **P10**
1. `SmsStatusReceiver` / `SmsIncomingReceiver`: use `goAsync()`; on failure, persist the report to a local outbox (Room table or JSON file in `filesDir`) retried by the service loop with backoff.
2. Dedupe: Android computes `idem_key = sha256(sender | body | sim_slot | timestamp_minutes)`; `record_inbound_sms` RPC enforces `unique(organization_id, idem_key)` with `on conflict do nothing`.

### 2.8 SIM-slot pinning stall guard → covers the H7 "stuck pending" edge for requested SIMs
`claim_next_sms`: when a message's `requested_sim_slot` has no eligible SIM on any device for >1 h, sweeper (2.6) rewrites `requested_sim_slot = null` and logs it, so the message can flow to any healthy SIM.

**Exit criteria:** chaos tests pass — kill device mid-drain → exactly-once delivery; multipart failure → no resend of delivered parts; two drains concurrently → pacing preserved; 2000-char message → 422 at API; forged inbound insert via anon key → blocked.


---

## Phase 3 — Realtime identity + scale (~3 days)

### 3.1 Device identity via Supabase Auth → fixes **C3**
Choose the JWT path so Realtime's RLS filtering finally passes for devices:
1. At pairing, service role creates an `auth.users` row per device (`email = device-<id>@gateway.internal`, random password) and returns a refresh token to the Android app; stored in EncryptedSharedPreferences.
2. Android `SupabaseManager` installs the `Auth` plugin and signs in once at service start; token refresh handled by the library.
3. RLS: add policy `"Device can read its org queue"` on `outbound_messages for select using (organization_id = device_org(auth.uid()))` — helper `device_org(uid)` maps device auth users → `gateway_devices.organization_id` (add `auth_user_id uuid` to `gateway_devices`, set at pairing).
4. Keep 10 s heartbeat polling as fallback; realtime insert events become the primary instant wake-up. Remove the duplicate channel creation (3.3).
*Fallback if auth-per-device is too heavy:* drop postgres_changes on Android and use a broadcast channel + FCM only, documenting polling as the wakeup path. JWT path is the default.

### 3.2 pg_cron for all maintenance → fixes **P1**, **P2**, feeds **2.1/2.6**
`0011_pg_cron.sql` schedules:
1. `reset_daily_sim_counters()` — every 5 min (remove from `claim_next_sms` hot path).
2. Lease orphan sweep (2.1.3) — every minute.
3. `mark_stale_devices_offline()` — every minute.
4. Stuck-message sweeper (2.6) — hourly.
5. Retention: delete delivered/failed `outbound_messages` and dispatched `inbound_messages` older than 90 days — nightly (**P12**).
6. Webhook outbox dispatcher (1.4) — every minute.
7. Purge expired `device_pairing_sessions` — nightly (**P8**).

### 3.3 Realtime channel manager on Android → fixes **P3**
`SupabaseManager.subscribeToQueue`: keep a single channel reference; `startRealtimeListener()` becomes idempotent (existing SUBSCRIBED channel → no-op). On network `onAvailable`, rely on supabase-kt auto-reconnect; only force re-subscribe on `CHANNEL_ERROR`, after removing the old channel.

### 3.4 Dashboard data flow → fixes **P4**
`web/app/page.tsx`, `messages/*`
1. Debounce realtime-triggered refetches (500 ms trailing edge, single-flight).
2. Apply event payloads directly to state (patch the changed row) instead of refetching all three tables; full refetch only on manual refresh.
3. Stop calling `mark_stale_devices_offline` from the browser (pg_cron owns it).
4. Keyset pagination (`created_at < cursor`), page size 50; drop the fixed `limit(500)`; stop selecting `message` bodies in list queries (slim columns, fetch body on detail open).

### 3.5 FCM wake-up hardening → fixes **P5**
`web/lib/fcm.ts`
1. `ttl: "30s"` + `collapse_key: "drain_queue"` — stale wake-ups self-expire, bursts collapse.
2. On `UNREGISTERED`/`INVALID_ARGUMENT`/`NOT_FOUND` responses → null out that `gateway_devices.fcm_token` (token pruning).
3. Fan out only to `status='online'` devices; fall back to all if none online.

### 3.6 Real telemetry on Android → fixes **P2** device side
`SmsGatewayService.kt`: `networkType` from `ConnectivityManager.NetworkCapabilities`; `signalStrength` from `TelephonyManager.getSignalStrength()` (mapped to 0–100); `appVersion` from `BuildConfig.VERSION_NAME`. Heartbeat carries the lease-extension flag (2.1).

**Exit criteria:** inserting a pending row wakes a device in <2 s; a dead device flips `offline` within 2 min with no dashboard open; the dashboard absorbs 100 events/min without refetch storms; stale FCM tokens self-clean.

---


---

## Phase 4 — API hygiene & hardening (~2 days)

### 4.1 Public API rate limiting → part of **P6**
Per-key fixed-window counter (`api_key_rate_limits(api_key_id, window_start, count)` upserted in `send-sms`), default 60 req/min, configurable per-key. Return 429 + `Retry-After`.

### 4.2 `last_used_at` batching + key lifecycle → **P6**
1. Remove the per-request UPDATE; instead insert into an append-only `api_key_usage(api_key_id, used_at)` log; pg_cron hourly rollup into `last_used_at`, nightly prune.
2. `0012_api_key_lifecycle.sql`: `revoked_at timestamptz, expires_at timestamptz`; `send-sms` rejects revoked/expired keys; dashboard gets a revoke UI.

### 4.3 Tenant timezone for quota reset → **P7**
`organizations add column quota_reset_tz text default 'UTC'`; the daily reset job resets per-org rows using `current_date AT TIME ZONE org.quota_reset_tz`; settings page exposes the selector.

### 4.4 Pairing atomicity → **P8**
`complete_device_pairing`: `select … for update` on the session row with the `status='claimed'` guard inside the same transaction; expired-session purge in 3.2.7.

### 4.5 Wakelock discipline → **P11**
Service wakelock `acquire(10 * 60_000)` + re-acquire inside the heartbeat loop while alive; release in `onDestroy` (already present). FCM wakelock already bounded by 2.4.

### 4.6 Low-severity cleanup → **P13**
1. `web/middleware.ts`: exclude `/api` from `updateSession` (API does its own auth now).
2. Bump edge functions to a current `deno.land/std` release; reuse a module-level Supabase client per isolate.
3. `ActivityLogManager`: make mutations atomic (`MutableStateFlow.update {}` on a holder or `Mutex`).
4. `webhook_secret`: keep plaintext (required for HMAC signing) but restrict `select` to admins (1.3) and never return it from APIs.
5. Operator runbook: un-quarantine a SIM, rotate webhook secret, revoke keys.

**Exit criteria:** burst → 429; revoked key rejected; two orgs in different timezones reset on their own local midnight; concurrent scan of the same QR creates exactly one device.

---

## Phase 5 — Verification & release (~1 day)

1. **Full regression on the local stack:** extend the pgTAP suite (Phase 0) with lease, quarantine, failover, dedupe, and rate-limit cases.
2. **Instrumented test on a real dual-SIM device:** multipart send, receipt aggregation, slot-pinned failure, boot recovery, FCM drain while the foreground service is active.
3. **Load test:** 5k messages across 3 orgs, 5 devices claiming → zero duplicates, p95 claim latency < 200 ms, no lock waits (`pg_stat_activity`).
4. **Security retest:** replay every finding (C1–C5, H5–H7) as an exploit — each must now fail; `git ls-files` secret audit; `supabase db lint`.
5. **Two-phase cutover:** ship an Android release requiring device tokens + lease heartbeats (in-app forced-update prompt), wait one release cycle, then deploy `0008_enforce_device_auth.sql` and remove legacy paths.

---

## Dependency graph & sequencing

```
Phase 0 ──► Phase 1 ──► Phase 2 ──► Phase 5 (release)
                │           │
                └──► Phase 3┴──► Phase 4  (can start after 1.3;
                                  3.5 depends on 2.4)
```
- 1.2 (device tokens) precedes 2.1 (lease heartbeats carry auth).
- 2.4 (non-blocking FCM) precedes 3.5 (TTL/collapse changes).
- 3.1 (device JWT) governs *reads* via RLS; RPC tokens from 1.2 still guard *writes* — complementary, not conflicting.

## Effort summary

| Phase | Duration | Issues closed |
|---|---|---|
| 0 Safety net | 0.5 d | infrastructure |
| 1 Security | 3 d | C1, C2, C5, H5, H6, part of H7 |
| 2 Delivery | 4 d | C4, H1, H2, H3, H4, H7, P9, P10 |
| 3 Scale/realtime | 3 d | C3, P1, P2, P3, P4, P5, P12 |
| 4 Hygiene | 2 d | P6, P7, P8, P11, P13 |
| 5 Verify/release | 1 d | regression + exploit retest |
| **Total** | **~13.5 working days** | **all 25 findings** |

Migrations shipped: `0004_indexes` → `0012_api_key_lifecycle` plus a pg_cron schedule script. Android ships as one feature release (token storage, receipt aggregator, lease heartbeat, single drain actor, goAsync receivers), followed by the enforcement cutover.

