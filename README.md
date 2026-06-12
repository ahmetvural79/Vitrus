<div align="center">

<img src="./assets/logo.svg?v=3" alt="Vitrus" width="440" />

### your glass-box company brain

Search hands you raw pages. Vitrus hands you **the answer + its sources + what it doesn't know** —
all in **portable Markdown files you own**.

[![License: MIT](https://img.shields.io/badge/License-MIT-6366F1.svg)](./LICENSE)
[![tests](https://img.shields.io/badge/tests-200%2B%20·%204%20gates-22c55e.svg)](#testing--gates)
[![MCP](https://img.shields.io/badge/MCP-stdio%20%2B%20HTTP-A855F7.svg)](#agents-mcp)
[![runtime](https://img.shields.io/badge/runtime-Bun-black.svg)](https://bun.sh)

[Live demo](https://vitrus.dev#demo) · [Quickstart](#install) · [Docs](#docs) · [Architecture](#architecture) · [Cloud](#vitrus-cloud) · [Roadmap](https://github.com/ahmetvural79/Vitrus/issues)

</div>

---

## What this looks like

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

That gap box is the point of the project. Every answer ships with its **sources** and an honest,
**deterministic** list of what your knowledge base *hasn't* documented. There is no LLM in the gap
detector, so it can't hallucinate a gap into existence — or out of it. A claim with no source is
shown as a gap, never papered over.

Three design rules hold everywhere:

- **Glass-box.** Every answer is *known / unknown (gap) / sourced*.
- **Ownable.** The source of truth is Markdown + a typed-edge sidecar in git. The index is disposable
  and rebuildable; delete it and your knowledge loses nothing.
- **Agent-native.** The same brain serves humans (CLI, dashboard) and agents (MCP, Agent Skills) from
  one permission-aware memory.

## Install

Pick your entry point:

```bash
# 1) Zero-setup local brain (PGLite, no database server)
bunx @vitrus/core init --pglite     # creates ./.vitrus
vitrus import ./brain               # ingest markdown (embeds + self-linking graph)
vitrus think "how was the outage resolved"

# 2) Wire it into Claude Code / Cursor / OpenClaw / Hermes as MCP — two commands
git clone https://github.com/ahmetvural79/Vitrus && cd Vitrus/packages/core && bun install && bun link
claude mcp add vitrus -- bunx @vitrus/mcp

# 3) Team scale: same engine on Postgres + pgvector
bun add pg
VITRUS_PG_URL=postgres://user@host/db vitrus import ./brain
```

`vitrus doctor` prints backend, providers and health (it never leaks secrets).

## Two ways to query your brain

```bash
vitrus search "rate limit"     # hybrid retrieval: vector + BM25 + entity → RRF-fused hits
vitrus think  "what is the payment rate limit and why"   # synthesized answer + sources + gap box + confidence
```

`search` gives you ranked nodes; `think` gives you the answer with provenance. Both respect ACLs and
both are honest about what isn't there.

And two that most tools don't have:

```bash
vitrus watch    # proactive: stale knowledge, unresolved incidents, aging gaps — what needs attention
vitrus verify "the rate limit for payments is 500 rps"
# → STALE — supported by decisions/d-007, but superseded during the outage (now 1000 rps)
```

`verify` returns one of four deterministic verdicts — **grounded · stale · contradicted ·
unsupported** — with supporting sources and conflicts. No LLM judge; it's hybrid search + gap
analysis over your own record. Also available programmatically (`@vitrus/core/verify`) and as an MCP
tool, so agents can fact-check **themselves** before acting.

## How to get data in

Markdown is canonical — anything that becomes Markdown becomes knowledge:

```bash
vitrus import ./brain          # a folder of .md files (+ optional .edges.json sidecars)
```

The connector framework is in the core (MIT): one interface (`fetch()` → records with **content +
ACL**), idempotent ingest, incremental prune, and **permission capture on every sync** — remove
someone from a channel and their access is revoked on the next sync, automatically.

Included adapters: **Slack** (threads → nodes, @mentions auto-linked to people) · **GitHub**
(issues/PRs) · **Email** (participants become the ACL) · **Calendar** · a generic **Docs** adapter
(Notion, Linear, Jira, Drive… map to one shape) · an **MCP-source bridge** (any MCP server becomes a
source). Everything funnels into **one brain**, so the same `alice` mentioned in Slack and authoring
a PR fuses into a single graph node.

## Capabilities

- **Gap analysis** — five deterministic kinds: *missing* (referenced but undocumented), *contradiction*
  (conflicting edges), *stale* (superseded), *single-point* (bus-factor risk), *uncited* (event with no
  source). Derived from graph structure and explicit text signals only.
- **Self-linking graph** — `[[type::slug]]` typed edges, extracted without an LLM; bi-temporal
  (valid-time + record-time), so "what did we believe then" is answerable.
- **Hybrid retrieval** — vector + BM25 + entity match, RRF-fused; optional reranker.
- **Provenance everywhere** — every claim traces to node → chunk → source URI.
- **ACL, fail-closed** — enforced at the index layer; unauthorized content never appears in results.
- **Confidence + freshness** — every answer carries a confidence score and oldest-source age.
- **Durable job queue** — `vitrus agent run "…" && vitrus agent work && vitrus jobs` (crash-recovering).

### Providers (BYO-LLM)

Offline-deterministic by default — no API key needed. Production providers are env-driven, one
interface:

| | Providers | Env |
|---|---|---|
| **Embedder** | OpenAI · Gemini · Cohere · offline hashing (default) | `VITRUS_EMBED_PROVIDER` |
| **Synthesizer** | OpenAI · Anthropic · Gemini · Ollama (local) · offline extractive | `VITRUS_SYNTH_PROVIDER` |
| **Reranker** | Cohere · Voyage · ZeroEntropy · lexical (default off) | `VITRUS_RERANK_PROVIDER` |

With a production embedder the brain is multilingual: ask in one language, retrieve sources written
in another.

## Agents (MCP)

Serve the brain to any agent over the Model Context Protocol — **stdio + Streamable HTTP**, with
OAuth 2.1 Resource Server support:

```bash
claude mcp add vitrus -- bunx @vitrus/mcp     # stdio, one line
vitrus-mcp --http 3000                        # or Streamable HTTP on :3000/mcp
```

Tools: `search` · `think` · `gap_report` · `provenance` · `get_node` · `verify`. Markdown sources are
exposed as `vitrus://node/<slug>` resources. Agents see **only what the token's user is allowed to
see** — ACL is enforced at the index layer, fail-closed. The output of an import can also be an
executable **Agent Skill (SKILL.md)** wired live to MCP.

## Architecture

Four layers, each depending only on the one below:

```
source of truth   markdown (+ .edges.json sidecar) in git   ← you own this
      ↓
engine            PGLite / Postgres+pgvector · hybrid search (vector + BM25 + entity → RRF)
      ↓                                       · self-linking graph ([[type::slug]], LLM-free) · bi-temporal edges
trust surface     gap analysis · provenance · verify · confidence · attention
      ↓
presentation      CLI · MCP (stdio + HTTP) · SKILL.md export · web dashboard (cloud)
```

Two engines, one contract: **PGLite** (WASM, zero-setup) for personal brains, **Postgres+pgvector**
for teams — same SQL, same engine, same answers. Invariants: **Markdown is canonical** (reset index →
rebuild → answer unchanged). **The graph is LLM-free.** **Gaps are deterministic.** **ACL is
fail-closed.**

## Testing & gates

Runs on **Bun** (no build step). Four CI gates, all green:

```bash
bun run typecheck      # strict tsc
bun run test           # 200+ tests (node:test runner)
bun run eval           # source-hit ≥90% + gap recall/precision 100%
bun run leak-test      # unauthorized access = 0 (ACL fail-closed)
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `vitrus: command not found` | `cd packages/core && bun link` (or use `bunx @vitrus/core`) |
| Answers feel weak in non-English | Set a production embedder: `VITRUS_EMBED_PROVIDER=openai` + key (default hashing embedder is language-naive) |
| `pg` errors on import | Team scale needs `bun add pg` and a reachable `VITRUS_PG_URL` (PGLite needs neither) |
| MCP server not showing tools | Check `claude mcp list`; for HTTP, the endpoint is `/mcp` and auth is `Authorization: Bearer <token>` |
| "is my index stale?" | The index is disposable: `vitrus reset && vitrus import ./brain` rebuilds everything from Markdown |
| Anything else | `vitrus doctor` first — it reports backend, providers and health without leaking secrets |

## Docs

| Guide | What's inside |
|---|---|
| [Quickstart](./docs/QUICKSTART.md) | From zero to a queried brain in 60 seconds. |
| [Architecture](./docs/ARCHITECTURE.md) | The layers, hybrid search, the self-linking graph, invariants. |
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
    migrations/ schema + row-level security
    test/       the test + eval + leak-test suites
  mcp/      @vitrus/mcp — the Model Context Protocol server (MIT)
docs/       the guides linked above
examples/   runnable recipes
assets/     logo + icon
```

This repo is the **open core**: everything above is MIT and self-hostable end-to-end, with no feature
flags and no fake "community edition". Gap analysis is never gated.

## Benchmarks

Gap detection has no public benchmark — so we built **Gap-Eval** (open corpus + harness, in this
repo) and publish the numbers with their methodology:

```bash
vitrus bench gapeval --determinism    # or: bun run gapeval
```

| metric | v0 result |
|---|---|
| Recall / precision (overall, 18 gold-labeled cases, 5 gap kinds) | 100% / 100% |
| False positives on clean brains (negative control) | 0 |
| Determinism (same brain → byte-identical gaps, twice) | PASS |

Honest framing: v0 is a **controlled synthetic corpus** (hand-authored brains with known gaps that
exercise the engine's real mechanisms — dangling wikilinks, `contradicts`/`supersedes` edges,
provenance-less events). It proves the detector does exactly what it documents, deterministically,
with zero fabricated gaps; it does not claim real-world generalization. The corpus lives at
[`packages/core/src/eval/gapeval/corpus`](packages/core/src/eval/gapeval/corpus) — adding a harder
case is a one-directory PR. Retrieval benchmarks (LongMemEval/LoCoMo format, BYO dataset) run via
`bun run bench`.

## Vitrus Cloud

There is also a hosted version at **[app.vitrus.dev](https://app.vitrus.dev)** — the same MIT engine
in this repo, deployed multi-tenant, for teams that don't want to run their own. What it adds is
operations, not capability:

- **Web dashboard** — Ask, **Gap Explorer**, knowledge **Graph**, **Entities**, **Verify**, and
  trace-to-source on every answer.
- **Managed connectors** — a gallery of 13 sources with stored credentials, scheduled sync and
  per-sync permission capture. Live sync: Slack, GitHub, Notion, Linear, Google Drive, **Jira,
  Confluence, GitLab, Discord**, and an **MCP bridge** (any MCP server's resources become a source);
  plus real-time WhatsApp webhook ingest and staged Email/Calendar imports.
- **A per-org MCP endpoint** — `https://api.vitrus.dev/t/<org>/mcp` with bearer auth, so your agents
  read the same brain your team does. Claude Code, Codex, Cursor, **OpenClaw**, **Hermes** — any MCP
  client over Streamable HTTP (copy-paste setup per agent on the dashboard's *Agent access* page):

  ```bash
  claude mcp add --transport http vitrus \
    https://api.vitrus.dev/t/<org>/mcp \
    --header "Authorization: Bearer <token>"

  openclaw mcp add vitrus --url https://api.vitrus.dev/t/<org>/mcp \
    --transport streamable-http --header "Authorization: Bearer <token>"
  ```

- **Team & ACL management** — roles (admin/member/viewer), seat-based membership, and an audit log of
  who asked what.
- **Account & support** — self-serve workspace administration and a built-in support desk (available
  on every account, including free ones).

Signing up is free — the Free plan includes the full dashboard with 1 brain · 1 seat · 2 connectors ·
5k nodes; Pro ($25/seat/mo or $249/seat/yr) adds seats and scale. Either way there is no lock-in by
design: your knowledge stays portable Markdown, and leaving the cloud means `vitrus import` on your
own machine.

## Contributing

Issues and PRs welcome — the [roadmap](https://github.com/ahmetvural79/Vitrus/issues) is real deferred
work, openly tracked. See [CONTRIBUTING.md](./CONTRIBUTING.md) and the
[security policy](./SECURITY.md). The fastest way to help: try the quickstart, and file an issue for
anything that didn't take 60 seconds.

## License + credit

`@vitrus/core` and `@vitrus/mcp` are **MIT** (see [LICENSE](./LICENSE)). The cloud apps (dashboard,
multi-tenant API) live in a separate non-public repo.

Vitrus draws on ideas explored by [GBrain](https://github.com/garrytan/gbrain) — Markdown-canonical
memory and an LLM-free typed graph — implemented independently here with its own engine and a
different emphasis: the gap box. If GBrain's shape fits you better, use it; honest memory winning in
any form is the point.

<div align="center">

**[vitrus.dev](https://vitrus.dev)** · **[live demo](https://vitrus.dev#demo)** · **[cloud dashboard](https://app.vitrus.dev)**

*Built for teams that want to trust their answers.*

</div>
