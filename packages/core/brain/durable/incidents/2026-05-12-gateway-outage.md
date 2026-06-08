---
type: incident
acl: group:eng, group:oncall
connector: slack
source_id: C0PLATFORM/p1715500000
uri: https://example.slack.com/archives/C0PLATFORM/p1715500000
captured_at: 2026-05-12T09:30:00Z
salience: 0.7
---

# 2026-05-12 · API Gateway kesintisi

[[durable/services/api-gateway]] sabah 09:14'te 503 dönmeye başladı; müşteri
[[durable/companies/acme]] etkilendi. Kök neden [[caused_by::durable/decisions/0007-rate-limit]]
kararındaki yeni eşikti. [[resolved_by::durable/people/alice]] eşiği geri alarak 09:41'te çözdü.
Müdahale [[durable/policies/incident-response]] politikasına göre yürütüldü.
Müşteriye duyuru [[durable/services/status-page]] üzerinden yapıldı (henüz belgelenmemiş servis).

## Açık konular
- Kalıcı rate-limit politikası yeniden tasarlanacak (termin 20 Mayıs).
- Postmortem [[durable/teams/platform]] ekibiyle paylaşılacak.
