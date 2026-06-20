---
name: capture-decision
description: Records a decision and its rationale back into the company brain after it is made, with sources, and detects supersede and contradiction effects. Use immediately after an architectural or process decision is reached.
version: 0.1.0
triggers:
  - we decided
  - the decision is
  - record this decision
  - going forward we will
tools:
  - Vitrus:record_decision
---
# Capture a decision

The brain stays live only if decisions are written back. Do it the moment a decision is reached.

## Steps
1. Call `Vitrus:record_decision` with: the decision (one line), the rationale, any source slugs/URLs, and `supersedes`/`contradicts` if it replaces or conflicts with prior knowledge.
2. Read the response: it runs gap analysis and reports any **contradiction** the new decision creates and anything it marked **stale**.
3. If a contradiction is reported, resolve it (see resolve-conflicts) — do not leave the brain inconsistent.

## Glass-box rule
Write the *reasoning*, not just the outcome. A decision without its "why" cannot be re-evaluated later.
