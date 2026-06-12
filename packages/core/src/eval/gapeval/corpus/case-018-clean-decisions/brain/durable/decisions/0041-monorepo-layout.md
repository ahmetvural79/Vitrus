---
type: decision
acl: public
salience: 0.5
---

# 0041 · Monorepo layout

Apps live in apps/, shared code in packages/. Builds use the cache described
in [[durable/concepts/build-caching]]. This layout
[[extends::durable/decisions/0040-typescript-strict]] by standardising the
compiler config at the repo root.
