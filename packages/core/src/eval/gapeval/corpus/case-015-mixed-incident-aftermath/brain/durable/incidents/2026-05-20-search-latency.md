---
type: incident
acl: group:eng
connector: slack
source_id: C0SEARCH/p1747720000
uri: https://example.slack.com/archives/C0SEARCH/p1747720000
captured_at: 2026-05-20T11:10:00Z
salience: 0.8
---

# 2026-05-20 · Search latency spike

p99 on [[durable/services/search-api]] went from 180ms to 2.4s during the
nightly rebuild, root cause [[caused_by::durable/decisions/0030-index-rebuild]].
Customer updates were posted to [[durable/services/status-page]] every
30 minutes during the incident.
