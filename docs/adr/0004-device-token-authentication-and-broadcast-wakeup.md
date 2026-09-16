# 4. Device Token Authentication and Realtime Broadcast Wake-Up

We decided to enforce cryptographic token authentication for all Gateway Device database procedures and replace table-level Postgres change streams with Supabase Realtime Broadcast channels for instant, RLS-free client wake-ups.

### Context

Previously, the Android pairing procedure stored a SHA-256 hash of a device token during initial setup, but subsequent database RPCs (`claim_next_sms`, `report_sms_result`, `record_device_heartbeat`, `record_device_fcm_token`) only accepted a bare `p_device_id`. Because these RPCs are `SECURITY DEFINER` and accessible by `anon`, an attacker with knowledge of a device UUID could claim and read queued messages or poison delivery status. Furthermore, Android devices subscribed to `postgres_changes` on `outbound_messages` via the unauthenticated `anon` client; because RLS filters out rows where `auth.uid()` is null, devices received zero Realtime events and silently operated only on 10-second polling.

### Decision

1. **Device Token Verification**:
   - Gateway devices securely persist their raw pairing token (`device_token`) in encrypted SharedPreferences.
   - Every device-side RPC requires `p_device_token TEXT`. The database executes `verify_device_auth(p_device_id, p_device_token)` by re-hashing the incoming token with SHA-256 and checking it against `gateway_devices.device_token_hash`.
2. **Realtime Broadcast Channels**:
   - Replaced `postgresChangeFlow` with a lightweight, public Supabase Realtime Broadcast channel (`gateway_wake_channel` / topic `queue:new_message`).
   - The Web Dashboard and API routes broadcast wake-up events upon queuing new outbound messages, triggering immediate, low-latency queue drains on listening devices without RLS friction.
3. **Defense-in-Depth FCM Wake-Up**:
   - High-priority FCM data pushes remain as the out-of-band wake-up mechanism when devices are in deep sleep / Doze mode, with TTL tightened to 30 seconds and automatic token pruning for invalid tokens.
