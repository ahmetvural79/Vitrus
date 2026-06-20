---
name: answer-with-sources
description: Answers a question from the company brain with cited sources and an honest list of what is not documented yet. Use when someone asks a factual question about the company, its systems, people, decisions or incidents.
version: 0.1.0
triggers:
  - what is
  - who owns
  - how do we
  - explain
  - summarize what we know about
tools:
  - Vitrus:think
  - Vitrus:provenance
---
# Answer with sources

Never answer company questions from memory. Pull the answer from the brain so every claim is cited and every gap is visible.

## Steps
1. Call `Vitrus:think` with the user's question. It returns a synthesized answer, numbered `[n]` citations, a confidence score, and a list of gaps.
2. Relay the answer **with its citations**. Keep the `[n]` markers — they map to real sources.
3. If `gaps` is non-empty, state plainly what the brain does **not** know instead of guessing.
4. To show where a claim came from, call `Vitrus:provenance` with the source slug (connector, link, captured-at).

## Glass-box rule
A claim without a source is not an answer. If confidence is low or a gap covers the question, say so — that honesty is the product.
