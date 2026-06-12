---
type: service
acl: group:eng
salience: 0.6
---

# Orders DB

Primary Postgres cluster for order data, operated by the [[durable/teams/data]]
team. Replica promotion is automated; lag alerts page the on-call engineer.
