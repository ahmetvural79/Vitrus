---
name: verify-before-claiming
description: Checks a claim against the company brain before stating it, returning grounded, stale, contradicted or unsupported with the supporting sources. Use before asserting any non-trivial fact about the company.
version: 0.1.0
triggers:
  - is it true that
  - verify
  - double-check
  - are we sure
tools:
  - Vitrus:verify
---
# Verify before claiming

Before asserting something important, check it against the brain deterministically.

## Steps
1. Call `Vitrus:verify` with the claim as a single sentence.
2. Read the verdict:
   - **grounded** — supported by sources; safe to state (cite them).
   - **stale** — was true but superseded; flag the newer version.
   - **contradicted** — sources disagree; surface both sides, do not pick silently.
   - **unsupported** — the brain has nothing; do not assert it.
3. Always pass the supporting source slugs through to the user.

## Glass-box rule
Trust the verdict, not your prior. Unsupported means "we don't know", not "probably yes".
