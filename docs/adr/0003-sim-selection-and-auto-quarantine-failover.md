# 3. SIM Selection, Balance Exhaustion, and Auto-Quarantine Failover

We decided to route Outbound Messages to eligible SIM Subscriptions ordered by nearest expiration and lowest balance first. If a SIM triggers 3 consecutive transmission failures, the system automatically transitions it into a Quarantined state and re-queues the message to an alternative active SIM.

### Context

Users purchase bundles of prepaid SMS credits with fixed validity windows and limited allowances. If messages are routed randomly, credits on near-expiry or low-volume bundles may expire unused. Furthermore, when a carrier blocks a SIM or the balance hits zero mid-cycle, subsequent messages repeatedly fail unless the faulty SIM is actively isolated.

### Decision

1. **Selection Heuristic**: Eligible SIMs must be active, online, below daily safety limits, and possess `available_balance > 0`. The database selects candidates ordered by `expires_at ASC NULLS LAST, available_balance ASC`.
2. **Failure Threshold & Quarantine**: When a Gateway Device receives a terminal carrier error (e.g. `RESULT_ERROR_GENERIC_FAILURE`), it reports the failure. If `consecutive_failures >= 3`, the SIM Subscription status is set to `quarantined`, emitting an alert event to the dashboard.
3. **Failover Execution**: Upon failure, the message's `retry_count` is incremented. If `retry_count < max_retries`, the message reverts to `pending` and is claimed by the next eligible SIM on the next iteration.
