---
name: trace-provenance
description: Traces where an answer came from, showing the source connector and link plus the exact passages that support it. Use when an answer must be audited, defended or fact-checked.
version: 0.1.0
triggers:
  - where did this come from
  - show the source
  - audit this answer
  - which passage
tools:
  - Vitrus:provenance
  - Vitrus:chunks
  - Vitrus:supporting_chunks
---
# Trace provenance

Every answer should be defensible down to the passage.

## Steps
1. `Vitrus:provenance` with a slug → which connector fetched it, the back-link, and when it was captured.
2. `Vitrus:supporting_chunks` with a slug + the question → the exact passages that support the answer, scored.
3. `Vitrus:chunks` with a slug → the full ordered chunks for a deeper audit.

## Glass-box rule
"The model said so" is never the source. Cite the connector, the link, and the passage.
