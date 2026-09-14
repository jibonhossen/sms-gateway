# SMS Gateway

A lightweight, multi-tenant SMS gateway system powered by **Supabase**, executed by **Android Gateway Devices**, and managed through a **Next.js Web Dashboard**.

## 🚀 Architecture

- **Control Plane (`/supabase`)**: PostgreSQL database with Row Level Security (RLS), Supabase Realtime WebSockets for instantaneous dispatch, and Edge Functions for public REST API and HMAC-signed webhooks.
- **Web Dashboard (`/web`)**: Multi-tenant management portal built with Next.js (App Router), Tailwind CSS, and shadcn/ui.
- **Android Client (`/android`)**: Lightweight Kotlin application (~400 lines) running a persistent foreground service with QR-code pairing, multi-SIM balance tracking, and carrier delivery receipts.

## 📁 Repository Structure

```
.
├── CONTEXT.md          # Canonical domain glossary and terms
├── docs/
│   └── adr/            # Architecture Decision Records
├── supabase/           # Database migrations, RLS policies, Edge Functions
│   ├── migrations/
│   └── functions/
├── web/                # Next.js 14/15 App Router web dashboard
└── android/            # Modern lightweight Android gateway client
```

## 📄 Documentation

- [Domain Context Glossary](CONTEXT.md)
- [ADR 0001: Supabase-Driven Gateway Architecture](docs/adr/0001-supabase-driven-gateway-architecture.md)
- [ADR 0002: Multi-Tenant SIM Quota & Failover](docs/adr/0002-multi-tenant-sim-quota-and-failover.md)
- [ADR 0003: SIM Selection Heuristic & Auto-Quarantine](docs/adr/0003-sim-selection-and-auto-quarantine-failover.md)
