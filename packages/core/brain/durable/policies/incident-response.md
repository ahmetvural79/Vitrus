---
type: policy
acl: public
salience: 0.9
---

# Politika · Incident Müdahalesi (Runbook)

Bu politika incident'ların nasıl çözüleceğini tanımlar.

## Adımlar
1. On-call mühendis [[durable/teams/platform]] kanalında durumu duyurur.
2. Etkilenen servis tespit edilir (ör. [[durable/services/api-gateway]]).
3. Son değişiklikler ve ilgili kararlar (ör. [[durable/decisions/0007-rate-limit]]) gözden geçirilir.
4. Geri alma veya hotfix uygulanır; çözüm kaydedilir.

> Not: Escalation matrisi yalnızca [[durable/people/alice]]'in bilgisinde — tek nokta riski.
