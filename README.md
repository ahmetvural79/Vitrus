<div align="center">

<img src="./assets/logo.svg" alt="Vitrus" width="440" />

### your glass-box company brain

**The brain that tells you not just what it *knows*, but what it *doesn't*.**
Search hands you raw pages. Vitrus hands you **the answer + its sources + what it doesn't know** —
all in **portable Markdown files you own**.

[![License: MIT](https://img.shields.io/badge/License-MIT-6366F1.svg)](./LICENSE)
[![tests](https://img.shields.io/badge/tests-202%20·%204%20gates-22c55e.svg)](#testing--gates)
[![MCP](https://img.shields.io/badge/MCP-stdio%20%2B%20HTTP-A855F7.svg)](#agent-native-mcp)
[![runtime](https://img.shields.io/badge/runtime-Bun-black.svg)](https://bun.sh)
[![scale](https://img.shields.io/badge/PGLite-→%20Postgres%2Bpgvector-4338CA.svg)](#scale-pglite--postgrespgvector)

**[🔮 Try the live demo](https://vitrus.dev#demo)** — no signup; ask it something it doesn't know and watch it *not* make things up.
**[☁️ Cloud dashboard](https://app.vitrus.dev)** · [Quickstart](#60-seconds) · [Docs](#documentation) · [Why Vitrus](#why-vitrus--three-boundary-lines) · [MCP](#agent-native-mcp) · [Roadmap](https://github.com/ahmetvural79/Vitrus/issues)

</div>

---

## What it looks like

```text
$ vitrus think "how was the payment outage resolved"

The payment service returned 503s due to a gateway rate-limit breach.
Resolved by raising the limit from 500 to 1000 rps [1], per the
rate-limit decision [2].

Sources:
  [1] durable/runbooks/rate-limit
  [2] durable/decisions/d-007

⚠ What your brain doesn't know (1):
  · "durable/companies/acme" is referenced but undocumented (missing)

Confidence: 82% · oldest source: 12 days
```

That gap box is the whole point. Every answer ships with its **sources** and an honest,
**deterministic** list of what your knowledge base *hasn't* documented — there is no LLM in the
gap detector, so it can't hallucinate a gap into existence (or out of it).

---

## 60 seconds

```bash
bunx @vitrus/core init --pglite     # zero-setup local brain (./.vitrus)
vitrus import ./brain               # ingest markdown (embeds + a self-linking graph)
vitrus think "how was the outage resolved"   # answer + [n] sources + GAP BOX + confidence
vitrus watch                        # proactive: what needs your attention (stale, unresolved, aging gaps)
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

Mem0, Zep, Glean — they all answer; **none tell you what they don't know.** This is Vitrus's single sharpest difference, and it's **deterministic and auditable** (no LLM, no fabrication): every gap is derived from graph structure or explicit text signals.

Five gap kinds: **missing** (referenced but undocumented) · **contradiction** (conflicting edges) · **stale** (superseded) · **single-point** (bus-factor risk) · **uncited** (an event with no source).

And the newest surface — **proactive, not reactive**: `vitrus watch` turns gap analysis temporal (stale knowledge, unresolved incidents, aging gaps) and tells you *what needs attention* without being asked.

## Verify — never trust self-report

An agent (or a teammate) asserts something. Is it actually true *according to your record*?

```bash
vitrus verify "the rate limit for payments is 500 rps"
# → STALE — supported by decisions/d-007, but superseded during the outage (now 1000 rps)
```

Four deterministic verdicts: **grounded** · **stale** · **contradicted** · **unsupported** — with the
supporting sources and conflicts. No LLM judge; it's hybrid search + gap analysis over your own data.
Also available programmatically (`@vitrus/core/verify` → `verifyClaim(engine, claim)`) and as an MCP
tool, so your agents can fact-check **themselves** before acting.

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

Serve the brain to any agent over the Model Context Protocol — **stdio + Streamable HTTP**, with OAuth 2.1 Resource Server support. Claude Code, Codex, Cursor and your own agents all share the same sourced, permission-aware memory your team uses:

```bash
# self-hosted, stdio — one line into Claude Code / Cursor
claude mcp add vitrus -- bunx @vitrus/mcp

# or serve over HTTP
vitrus-mcp --http 3000     # Streamable HTTP on :3000/mcp

# cloud (managed): every org gets its own authenticated MCP endpoint
claude mcp add --transport http vitrus \
  https://api.vitrus.dev/t/<org>/mcp \
  --header "Authorization: Bearer <token>"
```

Tools: `search` · `think` · `gap_report` · `provenance` · `get_node` · `verify`. Git-Markdown sources are exposed as `vitrus://node/<slug>` resources. Agents see **only what the token's user is allowed to see** — ACL is enforced at the index layer, fail-closed.

## Comparison

| | Plain search | ChatGPT | Glean | **Vitrus** |
|---|---|---|---|---|
| Answer (not pages) | ✗ | ✓ | ✓ | ✓ |
| Source / provenance | partial | weak | ✓ | ✓ |
| **Tells you what it doesn't know** | ✗ | ✗ | ✗ | **✓** |
| Data ownership / portable | ✗ | ✗ | ✗ (lock-in) | **✓ (markdown)** |
| Self-host / air-gapped | ✗ | ✗ | ✗ | **✓** |

## Connect your tools

The connector framework is in the core (MIT): one interface (`fetch()` → records with **content + ACL**),
idempotent ingest, incremental prune, and **permission capture on every sync** — remove someone from a
channel and their access is revoked on the next sync, automatically.

Included adapters: **Slack** (threads → nodes, @mentions auto-linked to people) · **GitHub** (issues/PRs)
· **Email** (participants become the ACL) · **Calendar** · a generic **Docs** adapter (Notion, Linear,
Jira, Drive… all map to one shape) · an **MCP-source bridge** (any MCP server becomes a source).
Everything funnels into **one brain**, so the same `alice` mentioned in Slack and authoring a PR fuses
into a single graph node. The managed cloud adds live OAuth fetchers, a connector gallery and a
real-time WhatsApp webhook on top of this exact framework.

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

## Documentation

| Guide | What's inside |
|---|---|
| [Quickstart](./docs/QUICKSTART.md) | From zero to a queried brain in 60 seconds. |
| [Architecture](./docs/ARCHITECTURE.md) | The 5 layers, hybrid search, the self-linking graph, invariants. |
| [CLI reference](./docs/CLI.md) | Every `vitrus` command, grouped by what it does. |
| [Providers](./docs/PROVIDERS.md) | Offline-default; plug in OpenAI/Ollama embedders, synthesizers, rerankers. |
| [Scaling](./docs/SCALING.md) | PGLite → Postgres+pgvector, migrations, the job queue, multi-tenant RLS. |
| [MCP](./docs/MCP.md) | Serve the brain to agents (stdio + HTTP); the tool set. |
| [Examples](./examples/README.md) | Six runnable recipes — graph, gaps, verify, MCP, Postgres. |

## Repository layout

```
packages/
  core/     @vitrus/core — engine, hybrid search, gap analysis, CLI, connectors (MIT)
    src/        the engine and CLI source (Bun runs TS directly, no build)
    brain/      a sample brain you can `vitrus import`
    migrations/ 0001..0006 (schema + RLS)
    test/       the test + eval + leak-test suites
  mcp/      @vitrus/mcp — the Model Context Protocol server (MIT)
docs/       the guides linked above
examples/   runnable recipes
assets/     logo + icon
```

The commercial apps (managed cloud, dashboard, connectors UI) live in a separate, non-public repo —
this repo is the **open core** you can self-host end-to-end.

## Open core

**Capability is free; scale + trust are paid.**

- **`@vitrus/core` + `@vitrus/mcp` → MIT.** Full engine, gap analysis, MCP, CLI, connectors, self-host. Real and unrestricted — no fake "community edition."
- **Cloud (managed connectors, dashboard, team/ACL, audit) → commercial.** The *same engine*, deployed multi-tenant.

**Gap analysis is never gated.** Money comes from hosting, managed connectors, teams and compliance — never from holding your data hostage.

## License

`@vitrus/core` and `@vitrus/mcp` are **MIT** (see [LICENSE](./LICENSE)). The cloud apps are commercial.

## Community

- ⭐ **Star the repo** if the gap box resonates — it's how other teams find an honest brain.
- 🗺️ [Roadmap & issues](https://github.com/ahmetvural79/Vitrus/issues) — real deferred work, openly tracked.
- 🤝 [Contributing](./CONTRIBUTING.md) · 🔒 [Security policy](./SECURITY.md)

<div align="center">

**[vitrus.dev](https://vitrus.dev)** · **[live demo](https://vitrus.dev#demo)** · **[cloud dashboard](https://app.vitrus.dev)**

*Built for teams that want to trust their answers.*

</div>
