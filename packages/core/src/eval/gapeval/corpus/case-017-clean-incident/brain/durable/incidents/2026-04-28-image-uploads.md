---
type: incident
acl: group:eng
connector: slack
source_id: C0INFRA/p1745830000
uri: https://example.slack.com/archives/C0INFRA/p1745830000
captured_at: 2026-04-28T09:12:00Z
salience: 0.6
---

# 2026-04-28 · Image upload failures

[[durable/services/media]] rejected uploads over 8 MB after a proxy buffer
change. [[resolved_by::durable/people/karl]] reverted the proxy config at
09:40. Follow-up: alert on the upload error rate, tracked by the
[[durable/teams/infra]] team.
