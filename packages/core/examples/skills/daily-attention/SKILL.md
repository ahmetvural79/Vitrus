---
name: daily-attention
description: "Triages what needs human attention now: stale durable knowledge, unresolved incidents and aging gaps, ranked by severity and age. Use at the start of a work session or on-call shift."
version: 0.1.0
triggers:
  - what needs attention
  - start of day
  - triage
  - what's aging
tools:
  - Vitrus:attention
---
# Daily attention

Start proactive, not reactive: let the brain tell you what is rotting.

## Steps
1. Call `Vitrus:attention` (optionally pass `now` as ISO). It returns severity-ranked items:
   - stale durable knowledge (not updated in a long time),
   - unresolved incidents (open too long, no resolution edge),
   - aging gaps (open and getting older).
2. Work top-down by severity. Close the loop: document, resolve, or escalate.

## Glass-box rule
Attention items are deterministic and time-aware — the same brain at the same time yields the same list.
