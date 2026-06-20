---
name: surface-gaps
description: "Surfaces what the company brain does not know: missing, stale, contradicted, single-point and uncited knowledge. Use before relying on the brain for a high-stakes task."
version: 0.1.0
triggers:
  - what don't we know
  - what's missing
  - gaps
  - blind spots
tools:
  - Vitrus:gap_report
---
# Surface gaps

The brain's honesty is its edge: it states what it does not know, deterministically.

## Steps
1. Call `Vitrus:gap_report`. It returns gaps by kind:
   - **missing** — referenced but undocumented nodes.
   - **stale** — superseded knowledge still in use.
   - **contradiction** — conflicting edges.
   - **single_point** — bus-factor risk (one person/owner).
   - **uncited** — incidents/decisions without a source.
2. Triage by impact and turn each into an action (document it, assign an owner, resolve the conflict).

## Glass-box rule
A gap is not a failure — it is a to-do. Reporting it beats silently guessing.
