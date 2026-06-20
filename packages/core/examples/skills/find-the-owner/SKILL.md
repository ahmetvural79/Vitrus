---
name: find-the-owner
description: Finds who owns or is responsible for a service, decision or area by traversing the typed knowledge graph and entity index. Use when someone needs to know who to talk to about X.
version: 0.1.0
triggers:
  - who owns
  - who is responsible for
  - who do I ask about
  - who runs
tools:
  - Vitrus:graph_query
  - Vitrus:entities
  - Vitrus:search
---
# Find the owner

The graph already encodes ownership — read it instead of guessing.

## Steps
1. Locate the thing: `Vitrus:search` for the service/decision to get its slug.
2. Traverse ownership: `Vitrus:graph_query` with that slug and edgeType `owns` (or `reports_to` for people, `depends_on` for systems).
3. For a broader map, `Vitrus:entities` lists people/teams by mention frequency.

## Glass-box rule
If no owner edge exists, that is an **unowned** finding — report the gap and suggest assigning an owner, do not invent one.
