---
name: onboard-area
description: Helps a newcomer learn an unfamiliar area of the company or codebase by mapping its key entities, owners and decisions from the brain. Use in the first days on a new team, service or domain.
version: 0.1.0
triggers:
  - help me get up to speed
  - onboard me on
  - learn about this area
  - new to this team
tools:
  - Vitrus:search
  - Vitrus:graph_query
  - Vitrus:entities
  - Vitrus:think
---
# Onboard an area

Shorten the learning curve: read the company's own memory instead of interrupting senior people.

## Steps
1. Map the landscape: `Vitrus:entities` for the key people/services/decisions in the area.
2. For each important node, `Vitrus:graph_query` (`owns`, `depends_on`, `reports_to`) to learn structure and who to ask.
3. Ask concrete questions with `Vitrus:think` — read the cited sources to learn *where* knowledge lives, not just the answer.
4. Note every gap you hit: those are the undocumented, tribal parts — flag them so the next newcomer onboards faster.

## Glass-box rule
When the brain has a gap, that is the thing to ask a human — then capture their answer (quick-note / capture-decision) so it is written down once.
