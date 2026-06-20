---
name: resolve-conflicts
description: Surfaces sources that disagree and resolves the conflict by keeping one side and marking the other superseded and stale. Use when two documents or decisions contradict each other.
version: 0.1.0
triggers:
  - these disagree
  - which is correct
  - conflict
  - contradiction
tools:
  - Vitrus:conflicts
  - Vitrus:resolve_conflict
---
# Resolve conflicts

When sources disagree, surface both sides — then resolve cleanly without silent overwrites.

## Steps
1. Call `Vitrus:conflicts` to list contradictions with both sides (slug + title) and whether each is open or resolved.
2. Determine the winner from evidence (recency, authority, verification).
3. Call `Vitrus:resolve_conflict` with `keep` = winning slug and `supersede` = losing slug, plus a reason. The loser is marked stale and the conflict resolved in the markdown source.

## Glass-box rule
Never overwrite the loser silently. Supersede leaves an auditable trail of what changed and why.
