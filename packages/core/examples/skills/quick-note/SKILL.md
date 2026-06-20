---
name: quick-note
description: Captures an ad-hoc note, idea or piece of context into the company brain in one step. Use when something worth remembering surfaces mid-task and should not be lost.
version: 0.1.0
triggers:
  - remember that
  - note to self
  - capture this
  - jot down
tools:
  - Vitrus:remember
---
# Quick note

Lower the friction of capture to near zero, so context is never lost.

## Steps
1. Call `Vitrus:remember` with the note content and an optional title. It writes to the markdown source and indexes it.
2. From a terminal the same thing is one command: `vitrus capture "the note"` (or pipe: `echo ... | vitrus capture`).
3. Drop a file into the inbox folder and run `vitrus ingest inbox <dir>` to capture from mobile (iOS Shortcuts/iCloud).

## Glass-box rule
Notes are working-tier and decay over time. Promote anything durable into a proper decision or document.
