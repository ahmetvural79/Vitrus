# Contributing to Vitrus

Thanks for your interest! Vitrus is **open core**: the engine + gap analysis + MCP + CLI
(`@vitrus/core`, `@vitrus/mcp`) are MIT and fully featured. The hosted cloud (managed
connectors, dashboard, team/ACL, audit) is a separate commercial product.

## Dev setup

```bash
bun install
cd packages/core
bun link            # → the `vitrus` command
```

## Gates (all must pass)

Runs on **Bun**; the test runner stays on Node (`node:test` subtests).

```bash
bun run typecheck   # strict tsc
bun run test        # node:test suite  (⚠ use `bun run test`, not `bun test`)
bun run eval        # source-hit ≥90% + gap recall/precision 100%
bun run leak-test   # unauthorized access = 0 (ACL fail-closed)
```

## Invariants (please don't break)

- **Markdown is the source of truth**; the index is disposable ("reset index → rebuild → answer unchanged").
- **The graph is LLM-free** — `[[type::slug]]` → typed edge by pure pattern.
- **Gap analysis is deterministic** — no fabricated gaps; derived from graph/text structure.
- **ACL is fail-closed** — the filter lives in the index layer.

## PRs

Keep changes surgical and matched to the surrounding style. New capability goes through the
`BrainEngine` contract first. Add tests; keep all four gates green.

By contributing you agree your contributions are licensed under the MIT License.
