---
type: incident
acl: group:eng
connector: github
source_id: acme/payments#812
uri: https://github.com/acme/payments/issues/812
captured_at: 2026-03-18T14:20:00Z
salience: 0.7
---

# 2026-03-18 · Duplicate payment retries

Customers were charged twice when the retry queue replayed acknowledged jobs.
The duplicates originated in [[durable/services/billing-worker]], which retried
on timeout without an idempotency key. Root cause traces back to
[[caused_by::durable/decisions/0021-retry-policy]].
[[resolved_by::durable/people/jonas]] drained the queue and refunded the
affected orders the same afternoon.
