# 5. Lease-Based Queue Dispatch, Reliable Webhook Outbox, and pg_cron Maintenance

We decided to replace static time-based orphan message resets with an explicit lease renewal model, introduce a transactional outbox table for webhook deliveries with exponential backoff, and delegate all background maintenance to `pg_cron`.

### Context

Previously, `claim_next_sms` executed a global, unindexed `UPDATE` setting any message in `processing` older than 2 minutes back to `pending`. When a device handled large backlogs under standard 2-second rate-limiting, messages regularly exceeded 2 minutes, causing concurrent devices to re-claim and re-send identical messages. Additionally, webhook dispatches wrote `webhook_dispatched_at` even on HTTP failures with no retry or dead-letter queue, and background tasks (such as daily quota resets and stale device detection) were run directly inside hot device polling queries or client-side dashboard renders.

### Decision

1. **Lease-Based Message Claiming**:
   - Outbound messages transition from `pending` to `processing` with an explicit `lease_expires_at` timestamp (default: 5 minutes).
   - Gateway Devices renew the lease while actively processing batches.
   - Any expired lease recovery increments `retry_count` toward `max_retries` to eliminate infinite redelivery loops.
2. **Multipart SMS & Status Outbox**:
   - The Android client employs a `ReceiptAggregator` with unique `PendingIntent` request codes per segment, ensuring a single terminal delivery report per multipart message.
   - Delivery and receipt reports are queued in a persistent local `ReportOutbox` with exponential retry, safeguarding against network dropouts or process termination.
3. **Webhook Outbox & SSRF Protection**:
   - Database triggers record outgoing webhook events into a `webhook_outbox` table.
   - Edge functions verify `response.ok`, implement exponential backoff, enforce HTTPS-only endpoints to prevent SSRF against internal cloud metadata, and move unresolvable events to a dead-letter state after max retries.
4. **Decoupled pg_cron Maintenance**:
   - Scheduled tasks (midnight quota resets by tenant timezone, stale device offline marking, orphan lease recovery, and webhook outbox sweeps) are executed asynchronously by `pg_cron` jobs, freeing hot transaction paths from full-table sequential scans.
