# 1. Supabase-Driven Gateway Architecture

We decided to replace the dual on-device embedded HTTP server (Ktor Netty) and custom cloud push sync (FCM/SSE) with a centralized Supabase control plane. The Android Gateway Device acts purely as a cellular peripheral connected via outbound WebSockets (Supabase Realtime), while the Web Dashboard and external APIs interface directly with Supabase Postgres.

### Considered Options

- **Legacy Embedded Server (Ktor Netty on Android)**: High battery drain, requires persistent local IP / port forwarding, fragile on mobile networks.
- **Custom Backend Server (Go/Node) + FCM**: High operational maintenance; requires maintaining custom databases, auth servers, and FCM relays.
- **Supabase Control Plane**: Zero server infrastructure to manage; native Realtime WebSockets, built-in Postgres row-level security (RLS), auto-generated REST/GraphQL APIs, and webhooks via Edge Functions.

### Consequences

- The Android application is reduced from ~16,000 lines of complex WorkManager and Ktor code to ~400 lines of reactive Kotlin.
- Android devices require no public IP or firewall exceptions, operating reliably over cellular data behind CGNAT.
- Message history, status tracking, authentication, and external webhooks are offloaded entirely to Supabase.
