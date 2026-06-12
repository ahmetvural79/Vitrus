---
type: incident
acl: group:eng
salience: 0.7
---

# 2026-05-30 · Checkout error spike

[[durable/services/checkout]] returned 500s for 4% of sessions between 18:05
and 18:32. [[resolved_by::durable/people/ravi]] rolled back the config change.
Recovery steps were taken from [[derived/runbooks/checkout-recovery]], which
nobody has written down yet, and no source link was recorded for this
incident.
