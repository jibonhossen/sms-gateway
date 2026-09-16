# SMS Gateway

A lightweight, Supabase-backed multi-tenant SMS gateway turning Android devices into cellular messaging relays managed via a Next.js web dashboard and HTTP API.

## Language

### Core Entities

**Organization**:
A tenant account that owns Gateway Devices, SIM Subscriptions, Outbound Messages, Inbound Messages, API Keys, and Webhook destinations.
_Avoid_: Account, workspace, team.

**Gateway Device**:
An Android hardware device running the cellular gateway service that connects to Supabase Realtime and executes SMS operations for an Organization.
_Avoid_: Phone, client, modem, worker node.

**Device Token**:
A cryptographic bearer secret generated on the Gateway Device during pairing and hashed (SHA-256) in the database to authenticate every device RPC.
_Avoid_: Session secret, client password, device key.

**SIM Subscription**:
A carrier profile bound to a physical or eSIM slot on a Gateway Device, with an allocated SMS balance, daily safety limit, expiration date, and health status.
_Avoid_: SIM card, line, phone plan, card.

**SIM Slot**:
The zero-based hardware index (0 or 1) on a dual-SIM Gateway Device identifying the physical tray or eSIM.
_Avoid_: Tray, socket, slot index.

**Outbound Message**:
An SMS message submitted via the Web Dashboard or API intended for cellular dispatch to a recipient.
_Avoid_: Send request, SMS task, outbound job.

**Inbound Message**:
An SMS message received by a Gateway Device's SIM Subscription and forwarded to Supabase.
_Avoid_: Received SMS, incoming payload.

**Webhook Outbox**:
A transactional database log table staging tenant webhook events (`sms.sent`, `sms.delivered`, `sms.received`, `sms.failed`) with exponential backoff and dead-letter handling.
_Avoid_: Webhook queue, event buffer, notification list.

### Operations & States

**Claim & Lease**:
The atomic database reservation of a pending Outbound Message by an active Gateway Device using row-level locking (`FOR UPDATE SKIP LOCKED`) and bounded expiration (`lease_expires_at`).
_Avoid_: Pull, fetch, checkout, consume.

**Broadcast Wake-Up**:
An instantaneous, RLS-free Supabase Realtime broadcast message dispatched over WebSockets to wake listening Gateway Devices immediately upon queue insertion.
_Avoid_: DB change trigger, push ping, pubsub event.

**Failover**:
The automatic reassignment of an Outbound Message to an alternative healthy SIM Subscription when the primary SIM fails, exhausts its balance, or encounters carrier errors.
_Avoid_: Fallback, backup send, retry hop.

**Quarantine**:
The automated administrative suspension of a SIM Subscription triggered after 3 consecutive carrier transmission failures to protect queue throughput.
_Avoid_: Blacklist, block, freeze.

**Delivery Receipt**:
The carrier-level confirmation received from the SMS Service Center (SMSC) that an Outbound Message was delivered to the recipient's handset.
_Avoid_: DLR, delivery status, delivery report.

**Heartbeat**:
A periodic telemetry packet sent by a Gateway Device reporting battery level, network type, signal strength, lease renewal, and liveness.
_Avoid_: Ping, keep-alive, check-in.

**Pairing Session**:
A temporary, single-use, 10-minute cryptographic exchange initiated via QR code or 6-digit code that binds a Gateway Device to an Organization.
_Avoid_: QR handshake, setup token, pair link.

**API Key**:
A hashed bearer credential used by external applications to authenticate requests to the Gateway REST API within an Organization.
_Avoid_: Auth token, secret key, access token.
