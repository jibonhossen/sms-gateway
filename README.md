# SMS Gateway

An enterprise-grade, lightweight, multi-tenant SMS gateway system powered by **Supabase**, executed by **Android Gateway Devices**, and managed through a **Next.js Web Dashboard**.

---

## 🚀 Architecture Overview

```
                          ┌────────────────────────┐
                          │   Next.js Dashboard    │
                          │      & REST API        │
                          └───────────┬────────────┘
                                      │
                         HTTPS / User Auth Session
                                      │
                                      ▼
                        ┌───────────────────────────┐
                        │   Supabase Control Plane  │
                        │ ┌───────────────────────┐ │
                        │ │ PostgreSQL + RLS      │ │
                        │ │ ├── Organizations     │ │
                        │ │ ├── Gateway Devices   │ │
                        │ │ ├── SIM Subscriptions │ │
                        │ │ ├── Outbound Messages │ │
                        │ │ └── Webhook Outbox    │ │
                        │ └───────────────────────┘ │
                        │ ┌───────────────────────┐ │
                        │ │ Realtime (Broadcast)  │ │
                        │ │ Edge Functions (Deno) │ │
                        │ │ pg_cron (Maintenance) │ │
                        │ └───────────────────────┘ │
                        └─────────────┬─────────────┘
                                      │
               Realtime Broadcast + FCM Push Wakeup
                                      │
                                      ▼
                      ┌───────────────────────────────┐
                      │    Android Gateway Device     │
                      │ ┌───────────────────────────┐ │
                      │ │ Foreground Service        │ │
                      │ │ Device Token Auth         │ │
                      │ │ Paced Dispatcher (2s)     │ │
                      │ │ Multipart Aggregator      │ │
                      │ │ Persistent Report Outbox  │ │
                      │ └───────────────────────────┘ │
                      │ ┌───────────────────────────┐ │
                      │ │ SIM Slot 0 │  SIM Slot 1  │ │
                      │ └───────────────────────────┘ │
                      └───────────────┬───────────────┘
                                      │
                               Cellular SMS / DLR
                                      │
                                      ▼
                              Mobile Recipients
```

- **Control Plane (`/supabase`)**: PostgreSQL database with Row Level Security (RLS), atomic lease-based queue dispatching, Realtime Broadcast channels for instant wake-ups, Edge Functions for public REST API and HMAC-signed webhooks, and `pg_cron` for background maintenance.
- **Web Dashboard (`/web`)**: Multi-tenant management portal built with Next.js (App Router), Tailwind CSS, Framer Motion, and shadcn/ui.
- **Android Client (`/android`)**: Modern Material 3 Kotlin application with dual-pairing (QR code or 6-digit code), persistent foreground service, device token authentication, battery optimization exemption, and robust carrier delivery tracking.

---

## 🛡️ Security & Reliability Highlights

1. **Cryptographic Device Authentication:**
   - Gateway devices generate and persist a bearer device token during initial pairing.
   - All device database RPCs (`claim_next_sms`, `report_sms_result`, `record_device_heartbeat`, `record_device_fcm_token`) verify the token hash against `gateway_devices.device_token_hash`.
2. **Session-Scoped Multi-Tenant API:**
   - `/api/messages/send` validates authenticated user sessions and resolves organizations strictly through `organization_members`.
3. **Lease-Based Queue Dispatch:**
   - Eliminates duplicate sends using `lease_expires_at` and heartbeat lease renewal. Expired lease recovery increments retry counts towards `max_retries`.
4. **Reliable Webhook Outbox:**
   - Transactional `webhook_outbox` table with HTTPS validation, SSRF protection against internal cloud metadata, exponential retry backoff, and dead-letter queue.
5. **Realtime Broadcast Wake-Up:**
   - Replaced table change streams with RLS-free Realtime Broadcast channels (`queue:new_message`), waking devices instantly alongside high-priority FCM pushes (30s TTL).

---

## 📁 Repository Structure

```
.
├── CONTEXT.md                  # Canonical domain glossary and entities
├── README.md                   # System documentation and setup guide
├── docs/
│   ├── SYSTEM_ANALYSIS_REPORT.md # 25-point vulnerability and performance audit
│   ├── FIX_PLAN.md             # System-wide hardening remediation plan
│   └── adr/                    # Architecture Decision Records (0001 - 0005)
├── supabase/
│   ├── migrations/             # SQL schemas, RLS policies, lease RPCs, pg_cron
│   └── functions/
│       ├── send-sms/           # Public REST API for external applications
│       └── dispatch-webhook/   # HMAC-signed webhook delivery worker
├── web/                        # Next.js App Router web dashboard
└── android/                    # Material Design 3 Android gateway app
```

---

## 🗄️ Database Migrations

The database is structured in additive migrations under `supabase/migrations/`:

| Migration | Purpose |
|---|---|
| `0001_initial_schema.sql` | Multi-tenant core tables, RLS policies, indexing, auto-org trigger |
| `0002_functions_and_triggers.sql` | Queue procedures, initial SIM routing heuristics, QR pairing |
| `0003_fcm_and_idempotency_fixes.sql` | FCM push token registration and idempotent balance deduction |
| `0004_security_and_rls.sql` | Device token authentication (`verify_device_auth`), role-based RLS, and secure inbound checks |
| `0005_lease_and_queue.sql` | Lease-based claiming (`lease_expires_at`), heartbeat lease renewal, and timezone-aware quotas |
| `0006_webhook_outbox.sql` | Transactional webhook staging, triggers, and retry/dead-letter state tracking |
| `0007_pg_cron.sql` | Decoupled background cron jobs for daily quota resets, stale devices, lease sweeps, and webhook retries |

---

## 🚀 Getting Started

### 1. Supabase Setup
1. Enable `pg_cron` and `pg_net` in your Supabase project (Dashboard → Database → Extensions).
2. Apply database migrations:
   ```bash
   supabase db push
   ```
3. Set application GUCs for `pg_cron` webhook retries:
   ```sql
   ALTER DATABASE postgres SET "app.settings.supabase_url" = 'https://<your-project-ref>.supabase.co';
   ALTER DATABASE postgres SET "app.settings.service_role_key" = '<your-service-role-key>';
   ```
4. Deploy Edge Functions:
   ```bash
   supabase functions deploy send-sms --no-verify-jwt
   supabase functions deploy dispatch-webhook
   ```

### 2. Web Dashboard Setup
```bash
cd web
pnpm install
cp .env.example .env.local  # Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
pnpm dev
```

### 3. Android Gateway App Setup
1. Open `android/` in Android Studio.
2. Add your `google-services.json` into `android/app/`.
3. Build and install the APK on an Android physical device with active SIM card(s):
   ```bash
   ./gradlew assembleDebug
   ```
4. Launch the app, grant SMS and notification permissions, exempt battery optimization, and scan the QR code from the Web Dashboard (or enter the 6-digit pairing code).

---

## 📄 Architecture Decision Records (ADRs)

- [ADR 0001: Supabase-Driven Gateway Architecture](docs/adr/0001-supabase-driven-gateway-architecture.md)
- [ADR 0002: Multi-Tenant SIM Quota & Failover](docs/adr/0002-multi-tenant-sim-quota-and-failover.md)
- [ADR 0003: SIM Selection Heuristic & Auto-Quarantine](docs/adr/0003-sim-selection-and-auto-quarantine-failover.md)
- [ADR 0004: Device Token Authentication & Broadcast Wake-Up](docs/adr/0004-device-token-authentication-and-broadcast-wakeup.md)
- [ADR 0005: Lease-Based Queue Dispatch & Reliable Webhook Outbox](docs/adr/0005-lease-based-dispatch-and-reliable-outbox.md)
