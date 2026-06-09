# Examples

Hands-on recipes. Each one runs against a local PGLite brain — no setup, no keys.

## 1. A brain from a folder of markdown

The repo ships a sample brain at [`packages/core/brain/`](../packages/core/brain). Point `import` at it:

```bash
vitrus init --pglite
vitrus import ./packages/core/brain
vitrus think "how was the outage resolved"
vitrus gaps
```

You'll get a synthesized answer with `[n]` citations, then a gap box listing what's referenced but
undocumented.

## 2. Watch the glass-box surface

```bash
vitrus attention      # ranked: stale knowledge, unresolved incidents, aging gaps
vitrus watch          # proactive loop over the above
```

## 3. Self-linking graph

Create two notes and link them with a typed wiki-link — the graph edge is built with **no LLM**:

```markdown
<!-- brain/decisions/pick-postgres.md -->
# Decision: pick Postgres
We standardize on Postgres + pgvector. Supersedes [[decision::pick-sqlite]].
```

```bash
vitrus import ./brain
vitrus think "what database did we pick and why"
# the dangling [[decision::pick-sqlite]] shows up in `vitrus gaps` until you document it
```

## 4. Verify a claim (deterministic)

```bash
vitrus verify "our backups run nightly"
# → grounded | stale | contradicted | unsupported, with the source
```

## 5. Give an agent the brain (MCP)

```bash
claude mcp add vitrus -- bunx @vitrus/mcp
# the agent now has search / think / gap_report / provenance / get_node / verify
```

## 6. Promote to Postgres (team)

```bash
bun add pg
VITRUS_PG_URL=postgres://user@host/vitrus vitrus init --postgres
VITRUS_PG_URL=postgres://user@host/vitrus vitrus import ./brain   # same brain, real DB
```

More detail in [docs/QUICKSTART.md](../docs/QUICKSTART.md) and [docs/CLI.md](../docs/CLI.md).
