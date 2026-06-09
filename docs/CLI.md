# CLI reference

`vitrus <command>` (after `bun link`), or `bun run dev -- <command>` without linking. Every command
reads the same brain the [MCP server](./MCP.md) serves.

## Setup

| Command | What it does |
| --- | --- |
| `vitrus init [--pglite\|--postgres]` | Create a brain. PGLite (default) writes to `./.vitrus`; Postgres uses `VITRUS_PG_URL`. |
| `vitrus doctor` | Print resolved backend + providers + health. Never prints secrets. |
| `vitrus config` | Show effective configuration (env-resolved). |
| `vitrus version` | Print version. |

## Ingest

| Command | What it does |
| --- | --- |
| `vitrus import <dir>` | Ingest a folder of markdown. Idempotent (content-hash). Builds the typed graph from `[[type::slug]]`. |
| `vitrus ingest <file>` | Ingest a single file. |
| `vitrus sync` | Re-sync changed sources. |
| `vitrus webhook` | Handle an incoming webhook payload (connector updates). |

## Query

| Command | What it does |
| --- | --- |
| `vitrus search <query>` | Hybrid search (vector + BM25 + entity → RRF). Returns ranked nodes. |
| `vitrus think <query>` | Synthesized answer + `[n]` citations + gap box + confidence. |
| `vitrus enrich <query>` | Answer plus expanded context and related nodes. |
| `vitrus verify <claim>` | Deterministic verdict: grounded / stale / contradicted / unsupported. |
| `vitrus chunks <node>` | Show the chunks of a node. |
| `vitrus entities` | List extracted entities. |

## Glass-box surface

| Command | What it does |
| --- | --- |
| `vitrus gaps` | What's referenced but undocumented, contradictory, stale, or uncited. Deterministic. |
| `vitrus attention` | Ranked "needs attention" items (stale knowledge, unresolved incidents, aging gaps). |
| `vitrus watch` | Proactive loop over `attention`. |
| `vitrus audit` | Audit the brain (coverage, orphan nodes, dangling links). |

## Skills (agent packs)

| Command | What it does |
| --- | --- |
| `vitrus skill [--publish]` | Export a `SKILL.md` pack. `--publish` refuses if the skill fails its own eval. |
| `vitrus skill-eval <name>` | Re-run a skill's frozen eval against the current brain (regression gate). |
| `vitrus skill-curate` | Surface skillify candidates and stale skills. |
| `vitrus skill-optimize` | Diagnose + regenerate a skill pack from the brain (self-heal). |

## Serve & operate

| Command | What it does |
| --- | --- |
| `vitrus mcp [--http <port>]` | Start the MCP server (stdio default; `--http` for Streamable HTTP). |
| `vitrus agent` | Run the built-in agent loop. |
| `vitrus dashboard` | Local inspection dashboard. |
| `vitrus jobs` | Inspect the job queue. |
| `vitrus dream` | Background maintenance loop (expire stale, refresh salience/entities). |
| `vitrus dedup` | Find and merge duplicate nodes. |
| `vitrus purge` | Hard-delete soft-deleted nodes past retention. |

See [PROVIDERS.md](./PROVIDERS.md) for switching embedders/synthesizers, and [SCALING.md](./SCALING.md)
for the Postgres backend.
