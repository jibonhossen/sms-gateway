# 2. Multi-Tenant Organization Model & SIM Quota-Aware Failover Routing

We decided to structure the system around multi-tenant Organizations where Gateway Devices report SIM Subscriptions with tracked available SMS balances. Outbound message routing selects the optimal SIM based on remaining quota and automatically executes failover to alternative SIMs upon transmission errors.

### Context

Users often insert multiple prepaid SIM cards with discrete SMS package quotas into one or more devices. When a SIM card runs out of balance or encounters carrier blocking, messages would fail unless the system dynamically detects failure and reallocates the message to another available SIM. Furthermore, supporting multi-tenancy allows different users or client organizations to manage their own isolated pools of devices and API keys.

### Decision

1. **Organization Tenancy**: All resources (`gateway_devices`, `sim_subscriptions`, `outbound_messages`, `api_keys`, `webhooks`) are scoped by `organization_id` with Postgres Row Level Security (RLS).
2. **Quota & Balance Tracking**: Each `sim_subscriptions` row maintains `available_balance` (decremented on successful send), `daily_limit`, and `sent_today`.
3. **Automated Failover**: When `claim_next_sms` runs, it selects the SIM with available balance. If the Android device reports a carrier error (e.g., `RESULT_ERROR_GENERIC_FAILURE`), the message `retry_count` increments and the claim procedure re-routes the message to an alternative eligible SIM Subscription.
