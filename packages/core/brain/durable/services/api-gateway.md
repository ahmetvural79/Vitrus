---
type: service
acl: public
connector: github
source_id: org/api-gateway
uri: https://github.com/org/api-gateway
---

# API Gateway

Tüm dış trafiğin giriş noktası. [[depends_on::durable/services/auth]] servisine bağımlı.
Rate-limit eşiği [[durable/decisions/0007-rate-limit]] kararına göre yönetilir.
