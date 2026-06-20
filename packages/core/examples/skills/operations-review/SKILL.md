---
name: operations-review
description: "Reviews the company as a system and flags operational risks: unowned services, single-person bus-factor, bottlenecks, broken handoffs and redundant tools, each citing the real nodes behind it. Use for a health check or before reorganizing."
version: 0.1.0
triggers:
  - operational risks
  - ops review
  - bottlenecks
  - bus factor
  - what's fragile
tools:
  - Vitrus:ops_report
---
# Operations review

Read the org as a graph of people, services and dependencies — the inefficiencies fall out deterministically.

## Steps
1. Call `Vitrus:ops_report`. Findings are severity-ranked:
   - **unowned** — service with no owner.
   - **bus_factor** — service depending on a single person.
   - **bottleneck** — person/team with too many inbound dependencies.
   - **broken_handoff** — dependency on superseded/stale ground.
   - **redundant_tool** — two near-duplicate services to consolidate.
2. For each, follow the cited nodes and propose a concrete fix (assign owner, add backup, split load).

## Glass-box rule
Every finding cites real nodes. This is evidence, not an LLM hunch — present it that way.
