---
name: read-before-act
description: Reads the company brain before acting and writes the decision back afterward, keeping shared memory live. Use as the default loop for any agent doing real work in the codebase.
version: 0.1.0
triggers:
  - before you start
  - default workflow
  - read before acting
  - agent loop
tools:
  - Vitrus:think
  - Vitrus:gap_report
  - Vitrus:record_decision
---
# Read before act, write after decide

The brain only compounds if agents read it first and write to it after.

## Before acting
1. `Vitrus:think` the task to pull relevant prior decisions, owners and constraints.
2. `Vitrus:gap_report` to see what is undocumented before you rely on it.

## After deciding
3. `Vitrus:record_decision` with the decision, rationale and sources. It flags any contradiction or staleness your decision created.

## Glass-box rule
Reading without writing back wastes the loop; the next agent (or you tomorrow) starts blind. Close it every time.
