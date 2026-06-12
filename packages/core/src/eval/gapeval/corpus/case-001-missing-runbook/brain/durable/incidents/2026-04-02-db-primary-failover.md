---
type: incident
acl: group:eng
connector: slack
source_id: C0DATA/p1743580800
uri: https://example.slack.com/archives/C0DATA/p1743580800
captured_at: 2026-04-02T07:55:00Z
salience: 0.7
---

# 2026-04-02 · Orders DB primary failover

[[durable/services/orders-db]] lost its primary at 07:41; writes failed for
nine minutes. [[resolved_by::durable/people/maya]] promoted the replica and
restored writes at 07:50. We followed [[derived/runbooks/database-failover]]
step by step — the section on verifying replication lag was out of date and
had to be improvised on the call.
