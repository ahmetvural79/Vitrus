<div align="center">

<img src="./assets/logo.svg" alt="Vitrus" width="440" />

### your glass-box company brain

**The brain that tells you not just what it *knows*, but what it *doesn't*.**
Search hands you raw pages. Vitrus hands you **the answer + its sources + what it doesn't know** —
all in **portable Markdown files you own**.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache--2.0-6366F1.svg)](./LICENSE)
[![tests](https://img.shields.io/badge/tests-202%20·%204%20gates-22c55e.svg)](#testing--gates)
[![MCP](https://img.shields.io/badge/MCP-stdio%20%2B%20HTTP-A855F7.svg)](#agent-native-mcp)
[![runtime](https://img.shields.io/badge/runtime-Bun-black.svg)](https://bun.sh)
[![scale](https://img.shields.io/badge/PGLite-→%20Postgres%2Bpgvector-4338CA.svg)](#scale-pglite--postgrespgvector)

[vitrus.dev](https://vitrus.dev) · [Quickstart](#60-seconds) · [Why Vitrus](#why-vitrus--three-boundary-lines) · [MCP](#agent-native-mcp) · [Open core](#open-core)

</div>

---

## 60 seconds

```bash
bunx @vitrus/core init --pglite     # zero-setup local brain (./.vitrus)
vitrus import ./brain               # ingest markdown (embeds + a self-linking graph)
vitrus think "how was the outage resolved"   # answer + [n] sources + GAP BOX + confidence
vitrus watch                        # proactive: what needs your attention (stale, unresolved, aging gaps)
vitrus ops                          # operational inefficiencies (unowned · bottleneck · bus-factor · redundant)
vitrus conflicts                    # contradictions, both sides — resolve: vitrus resolve <keep> <drop>
vitrus hooks install --agent claude # agents read before they act, write after they decide
```

> Signature output: alongside the answer, a **"what your brain doesn't know"** (gap) box.
> **No one else in the market shows you this.**

Developer setup (gbrain-style single command):

```bash
git clone … && cd packages/core && bun install && bun link   # → the `vitrus` command, anywhere
claude mcp add vitrus -- bunx @vitrus/mcp                     # wire into Claude Code / Cursor
```

---

## Why Vitrus — three boundary lines

- **🔍 Glass-box.** Every answer is *known / **unknown (gap)** / sourced*. A claim with no source is shown as a **gap**, never fabricated.
- **📦 Ownable.** The source of truth is Markdown + a typed-edge sidecar in git. The index is **disposable and rebuildable**. No lock-in — leave whenever you want.
- **🤖 Agent-native.** The output is an executable **Agent Skill (SKILL.md)** wired live to MCP. Humans and agents drink from the same trusted memory.

## Signature feature: gap analysis

Other company-brain and enterprise-search tools answer — but **none tell you what they don't know.** This is Vitrus's single sharpest difference, and it's **deterministic and auditable** (no LLM, no fabrication): every gap is derived from graph structure or explicit text signals.

Five gap kinds: **missing** (referenced but undocumented) · **contradiction** (conflicting edges) · **stale** (superseded) · **single-point** (bus-factor risk) · **uncited** (an event with no source).

And the newest surface — **proactive, not reactive**: `vitrus watch` turns gap analysis temporal (stale knowledge, unresolved incidents, aging gaps) and tells you *what needs attention* without being asked.

## Beyond gaps — the systems map, conflicts & the write-back loop

Same deterministic, no-LLM engine, three more surfaces (each with a CLI command **and** an MCP tool):

- **🗺️ Ops-map** — `vitrus ops` · MCP `ops_report`. Reads the company as a graph and flags operational inefficiencies: **unowned** services, **bus-factor** (single-person) risk, **bottlenecks** (overloaded hubs), **broken handoffs** (depending on superseded ground), and **redundant tools** (embedding-similar services). Severity-ranked; every finding cites the real nodes — evidence, not a consultant's guess.
- **⚖️ Conflict resolution** — `vitrus conflicts` / `vitrus resolve` · MCP `resolve_conflict`. Detects contradictions and shows **both sides**; resolve by choosing the winner — the loser is superseded (marked stale) and the conflict closes. Nothing overwritten in silence.
- **✍️ Write-back loop** — `record_decision`, `capture_session` · `vitrus hooks install`. Agents **read before they act and write after they decide** — decisions persist with their sources, so the brain stays live without anyone writing docs. A new decision that contradicts an existing one is flagged back to the agent (never a silent overwrite).

## Live connectors

Seven first-class live connectors over one injectable, mock-testable HTTP layer (**5 pagination styles**: REST-Link, GET-cursor, POST-cursor, GraphQL, offset, pageToken):

**GitHub · Slack · Notion · Linear · Jira · Drive · Gmail**

Incremental sync (`--since`, prune-safe), **webhook → live delta** (GitHub direct; Slack triggers a re-sync), and a **durable, crash-recovery sync queue** with idempotent jobs + a cron scheduler. Tokens live in an **AES-256-GCM vault** (cloud), per-tenant isolated.

```bash
GITHUB_TOKEN=… vitrus ingest github --live --repo owner/name      # pull (incremental with --since)
vitrus ingest slack --live --channel C0… --queue                  # enqueue a durable sync job
```

---

## Providers (BYO-LLM)

Offline-deterministic by default (no key needed), **or** production providers — all env-driven, one interface:

| | Providers | Env |
|---|---|---|
| **Embedder** | OpenAI · Gemini · Cohere · offline hashing (default) | `VITRUS_EMBED_PROVIDER` |
| **Synthesizer** | OpenAI · Anthropic · Gemini · Ollama (local) · offline extractive | `VITRUS_SYNTH_PROVIDER` |
| **Reranker** | Cohere · Voyage · ZeroEntropy · lexical (default off) | `VITRUS_RERANK_PROVIDER` |

```bash
VITRUS_EMBED_PROVIDER=gemini GEMINI_API_KEY=… \
VITRUS_RERANK_PROVIDER=cohere COHERE_API_KEY=… vitrus think "…"
vitrus doctor      # backend + provider + health report (never leaks secrets)
```

> Multilingual brain: with a production embedder, ask in one language and retrieve sources in another. The answer follows your query's language; the corpus is language-agnostic.

## Scale: PGLite → Postgres+pgvector

Personal/dev = zero-setup PGLite (WASM). Team/scale = Postgres+pgvector — **same SQL, same engine**:

```bash
VITRUS_PG_URL=postgres://user@host/db vitrus import ./brain    # first: bun add pg
```

Durable, crash-recovering job queue: `vitrus agent run "…" && vitrus agent work && vitrus jobs`.

---

## Agent-native (MCP)

Serve the brain to any agent over the Model Context Protocol — **stdio + Streamable HTTP**, with OAuth 2.1 Resource Server support:

```bash
vitrus-mcp                 # stdio (Claude Code / Cursor)
vitrus-mcp --http 3000     # Streamable HTTP on :3000/mcp
```

Tools: `search` · `think` · `gap_report` · `provenance` · `get_node` · `verify`. Git-Markdown sources are exposed as `vitrus://node/<slug>` resources.

## Comparison

| | Plain search | ChatGPT | Enterprise search | **Vitrus** |
|---|---|---|---|---|
| Answer (not pages) | ✗ | ✓ | ✓ | ✓ |
| Source / provenance | partial | weak | ✓ | ✓ |
| **Tells you what it doesn't know** | ✗ | ✗ | ✗ | **✓** |
| Data ownership / portable | ✗ | ✗ | ✗ (lock-in) | **✓ (markdown)** |
| Self-host / air-gapped | ✗ | ✗ | ✗ | **✓** |

---

## Architecture

Four layers, each depending only on the one below:

```
source of truth   markdown (+ .edges.json sidecar) in git   ← you own this
      ↓
engine            PGLite / Postgres+pgvector · hybrid search (vector + BM25 + entity → RRF)
      ↓                                       · self-linking graph ([[type::slug]], LLM-free) · bi-temporal edges
trust surface     gap analysis · provenance · verify · confidence · attention
      ↓
presentation      CLI · MCP (stdio + HTTP) · SKILL.md export
```

Invariants: **Markdown is canonical** (reset index → rebuild → answer unchanged). **The graph is LLM-free.** **Gaps are deterministic.** **ACL is fail-closed.**

## Testing & gates

Runs on **Bun** (no build step). Four CI gates, all green:

```bash
bun run typecheck      # strict tsc
bun run test           # 202 tests (node:test runner)
bun run eval           # source-hit ≥90% + gap recall/precision 100%
bun run leak-test      # unauthorized access = 0 (ACL fail-closed)
```

## Open core

**Capability is free; scale + trust are paid.**

- **`@vitrus/core` + `@vitrus/mcp` → Apache-2.0.** Full engine, gap analysis, MCP, CLI, connectors, self-host. Real and unrestricted — no fake "community edition."
- **Cloud (managed connectors, dashboard, team/ACL, audit) → commercial.** The *same engine*, deployed multi-tenant.

**Gap analysis is never gated.** Money comes from hosting, managed connectors, teams and compliance — never from holding your data hostage.

## License

`@vitrus/core` and `@vitrus/mcp` are **Apache-2.0** (see [LICENSE](./LICENSE)). The cloud apps are commercial.

<div align="center">

**[vitrus.dev](https://vitrus.dev)**

</div>
