---
type: decision
acl: public
salience: 0.3
---

# 0008 · Pin production Postgres at 13

Production databases stay on Postgres 13 until the JSONB planner regression in
14 is fixed upstream. Revisit after the next LTS cycle.
