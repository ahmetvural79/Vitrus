# Quickstart

Vitrus runs on [Bun](https://bun.sh) with **no build step** — the `bin` points straight at the
TypeScript source.

## 60 seconds (local, zero setup)

```bash
bunx @vitrus/core init --pglite        # create a local brain in ./.vitrus (WASM Postgres + pgvector)
vitrus import ./brain                   # ingest a folder of markdown (embeds + builds a typed graph)
vitrus think "how was the outage resolved"
```

`think` prints a synthesized answer, `[n]` citations, a **gap box** ("what the brain doesn't know"),
and a confidence card.

## Install the global command

```bash
git clone https://github.com/ahmetvural79/Vitrus && cd Vitrus
bun install
cd packages/core && bun link            # registers `vitrus` (CLI) + `vitrus-mcp` (MCP server)
```

Now `vitrus <cmd>` works from any directory. (`bun run dev -- <cmd>` is the same CLI without linking.)

## Wire it into an agent (MCP)

```bash
claude mcp add vitrus -- bunx @vitrus/mcp     # Claude Code / Cursor
```

Your agent now has `search`, `think`, `gap_report`, `provenance`, `get_node` and `verify` tools, all
reading the same brain you query from the CLI.

## A first brain

Point `import` at any folder of markdown. Files become nodes; `[[type::slug]]` links become typed
graph edges (no LLM). The folder is the source of truth — the index in `./.vitrus` is disposable and
can always be rebuilt:

```bash
vitrus import ./brain      # re-run anytime; idempotent (content-hash based)
vitrus gaps                # list what's referenced but undocumented, contradictory, stale, uncited
vitrus watch               # proactive: stale knowledge, unresolved incidents, aging gaps
```

## Providers (optional)

Offline-deterministic by default (no key). Plug in a real LLM whenever you want — see
[PROVIDERS.md](./PROVIDERS.md).

```bash
VITRUS_EMBED_PROVIDER=openai OPENAI_API_KEY=sk-... vitrus think "..."
vitrus doctor    # shows the resolved backend + providers (never prints secrets)
```

## Scale up

Personal/dev uses zero-setup PGLite. For a team, point at Postgres+pgvector — same SQL, same engine.
See [SCALING.md](./SCALING.md).

```bash
VITRUS_PG_URL=postgres://user@host/db vitrus import ./brain   # first: bun add pg
```

Next: [ARCHITECTURE.md](./ARCHITECTURE.md) · [CLI.md](./CLI.md) · [MCP.md](./MCP.md)
