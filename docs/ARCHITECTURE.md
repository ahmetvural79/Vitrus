# Architecture

Vitrus is a **glass-box** knowledge engine: every answer carries its sources, its confidence, and an
explicit list of what the brain *doesn't* know. Nothing is a black box.

```
            markdown / connectors (source of truth)
                          │
                    ┌─────▼─────┐
        ingest      │  parse +  │   [[type::slug]] → typed edges (no LLM)
                    │  chunk +  │   front-matter → entities, timestamps
                    │  embed    │
                    └─────┬─────┘
                          │
                    ┌─────▼──────────────────────────────┐
        store       │  SqlDriver  (PGLite  |  Postgres)   │  same SQL, same engine
                    │  nodes · chunks · edges · entities  │  pgvector + tsvector
                    └─────┬──────────────────────────────┘
                          │
        retrieve   ┌──────▼───────┐
                   │ hybrid search│  vector + BM25 + entity  →  RRF (k=60)
                   └──────┬───────┘
                          │
        reason      ┌─────▼─────┐   synthesize answer + citations
                    │ synthesize│   gap analysis (deterministic)
                    │  + gaps   │   confidence card
                    └─────┬─────┘
                          │
        serve      CLI · MCP (stdio + HTTP) · SKILL.md export
```

## Layers

**1. Ingest.** `import` walks a folder; each markdown file is a node. Content is chunked and embedded.
`[[type::slug]]` wiki-links become typed graph edges with **no LLM call** — the graph is built from
text, so it is deterministic and free. Front-matter supplies entities and timestamps (for bi-temporal
edges: `valid_from` / `valid_to`). Imports are idempotent — re-running only touches changed files
(content-hash based).

**2. Store.** One `SqlDriver` interface, two backends: **PGLite** (WASM Postgres, zero-setup, on disk
in `./.vitrus`) and **Postgres + pgvector** (teams). `PostgresEngine extends PgliteEngine` — the same
SQL runs on both, so you can prototype locally and promote to a server without changing a query. See
[SCALING.md](./SCALING.md).

**3. Retrieve — hybrid search.** Three retrievers run in parallel:
- **Vector** (pgvector cosine) — semantic similarity
- **BM25** (Postgres full-text) — exact-term / lexical
- **Entity** — graph hops from matched entities

Results are fused with **Reciprocal Rank Fusion** (RRF, k=60) — no score normalization needed, robust
to scale differences. An optional reranker re-orders the top fused set.

**4. Reason.**
- **Synthesis** composes an answer from retrieved chunks with `[n]` citations back to source nodes.
- **Gap analysis** is **deterministic** (no LLM): it finds links pointing at undocumented nodes,
  contradictions, stale/aging knowledge, and answers that lack citations. This is the "what's missing"
  box — the core glass-box guarantee.
- **Confidence** is reported per answer from coverage + citation density.

**5. Serve.** The same engine backs the [CLI](./CLI.md), the [MCP server](./MCP.md) (so agents query
the identical brain), and a `SKILL.md` export.

## Invariants

- **Markdown is the source of truth.** The index in `./.vitrus` is derived and disposable — delete it
  and `import` rebuilds everything. Connectors (in the commercial layer) fetch remote data *into* the
  same markdown-shaped node model; the file/document is always authoritative.
- **No hidden LLM.** Graph building and gap analysis never call a model. Embedding/synthesis providers
  are pluggable and offline-deterministic by default — see [PROVIDERS.md](./PROVIDERS.md).
- **Every answer is auditable.** Citations resolve to nodes; `provenance` traces a node to its source;
  gaps are explicit.

## Self-linking graph

Write `[[decision::pick-postgres]]` in any document and Vitrus creates a typed edge to the
`decision/pick-postgres` node — even before that node exists (a dangling link *is* a gap the engine
reports). Edges are bi-temporal: an edge can be valid for a time window, so "what did we believe in
March" is answerable.

## Multi-tenant (commercial layer, not in this repo)

The open core is single-brain. The cloud layer adds org-scoping with Postgres **row-level security**
(`FORCE ROW LEVEL SECURITY`, a non-superuser app role, `app.current_org` set per request) so a query
in org B can never see org A's rows — enforced in the database, fail-closed.
