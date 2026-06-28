<div align="center">

<img src="./assets/logo.svg?v=3" alt="Vitrus" width="440" />

### your glass-box company brain

Search hands you raw pages. Vitrus hands you **the answer + its sources + what it doesn't know** —
all in **portable Markdown files you own**.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache--2.0-6366F1.svg)](./LICENSE)
[![tests](https://img.shields.io/badge/tests-295%20·%205%20gates-22c55e.svg)](#testing--gates)
[![MCP](https://img.shields.io/badge/MCP-stdio%20%2B%20HTTP-A855F7.svg)](#agents-mcp)
[![runtime](https://img.shields.io/badge/runtime-Bun-black.svg)](https://bun.sh)

[Live demo](https://vitrus.dev#demo) · [Quickstart](#install) · [Docs](#docs) · [Architecture](#architecture) · [Cloud](#vitrus-cloud) · [Roadmap](https://github.com/ahmetvural79/Vitrus/issues)

</div>

---

## ✨ What you can do

> **One brain — read by humans *and* agents. It cites every claim, and admits what it doesn't know.**

- 🧠 **Ask your company in plain language** → a sourced answer plus an honest list of what isn't documented ([see it](#what-this-looks-like)).
- 🔌 **Make any API agent-native.** Import an OpenAPI spec, retrieve the right endpoint for a task, and **verify the call before it runs** — no hallucinated endpoints or arguments. `vitrus api import|search|verify|call`.
- 🎓 **Onboard a new hire (or agent) on day one.** A sourced, pedagogically-ordered learning path with *who to ask* and *what's still undocumented*, plus quizzes graded against the brain. `vitrus onboard|quiz`.
- 🔎 **Trust the ranking.** `--explain` prints every score factor; graph-signal ranking promotes results that are connected to, or corroborated across, other sources.
- ⚡ **Capture without friction.** One-command notes, ingest from any REST endpoint, or drop files in a watched inbox folder. `vitrus capture` · `vitrus ingest rest|inbox`.
- 📥 **Bring the notes you already have.** Import an Obsidian vault, a Notion export, or your ChatGPT/Claude history — or migrate from GBrain — straight into the same glass-box brain. `vitrus import-obsidian|notion|chat|gbrain`.
- 🤖 **30 MCP tools** so Claude, Cursor and your own agents share the exact same trusted, permission-aware memory.

*New since the last release — see [What's new](#whats-new-2026-06) below.*

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

## What's new (2026-06)

- **Bring your existing notes.** `vitrus import-obsidian` (vault + `[[wikilinks]]` → typed edges),
  `vitrus import-notion` (Notion markdown export), `vitrus import-chat` (ChatGPT/Claude
  `conversations.json`), `vitrus import-gbrain` (migrate from GBrain) — all map into the same glass-box brain.
- **8 one-token connectors.** Stripe · HubSpot · Salesforce · Asana · Microsoft Teams · Dropbox · Figma ·
  Zoom — preset REST connectors: pick one, paste a token, it syncs. No bespoke code (built on the generic REST engine).
- **Self-maintaining dream loop.** Nightly `vitrus dream` now also runs **citation-fix** (suggest a sourced
  match for every uncited node) and a **contradiction digest** (open contradictions + which side is newer);
  `vitrus brief` prints a deterministic morning briefing (attention + gaps + conflicts + fixable-uncited).
- **Schema packs.** `vitrus schema lint` checks your taxonomy deterministically (unknown node/edge types,
  edge from→to violations against the `vitrus-base` pack); `vitrus schema explain <type>` documents any
  type and the edges it participates in. (MCP `schema_lint` / `schema_explain_type`.)
- **Agent-native API hub.** Import an OpenAPI spec (`vitrus api import <spec>`), retrieve the right endpoint for a task (`vitrus api search`), and **verify a call deterministically before running it** (`vitrus api verify` → valid / missing_args / wrong_type / unknown_args / **unknown_endpoint** / deprecated) — the anti-hallucination gate. `vitrus api call` verifies, then executes. Also `vitrus ingest rest --config <c.json>` to pull any REST response into the brain. Visual API-integration drawer in the dashboard.
- **Day-one onboarding.** `vitrus onboard "<role>"` builds a sourced, pedagogically-ordered learning path from the brain (who to ask + what's not documented yet); `vitrus quiz "<topic>"` generates recall questions graded deterministically by `verify`.
- **`--explain` ranking attribution.** `vitrus search "<q>" --explain` prints each hit's score factors: vector/bm25/entity ranks + tier/cosine and the new **graph-adjacency / cross-source** boosts.
- **Graph-signal ranking.** A deterministic, ACL-safe re-scoring after hybrid search: results connected to other top hits, or corroborated across sources, rise.
- **Native Voyage + ZeroEntropy embedders** (Matryoshka-fit to the frozen `vector(1536)` schema — no migration).
- **MCP surface 13 → 30 tools** (`entities`, `graph_query`, `get_node`, `chunks`, `attention`, `conflicts`, `api_search`/`api_verify`/`api_call`, `onboarding_path`, `quiz`, `schema_lint`/`schema_explain_type`, `briefing`, …; content tools are ACL fail-closed).
- **One-command capture.** `vitrus capture "<note>"` (arg/file/stdin) + a watched inbox folder (`vitrus ingest inbox <dir>`) for mobile capture.
- **12 prebuilt skills.** `vitrus skills list|install` — a validated SKILL.md library that teaches agents how to use Vitrus.

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
vitrus import ./brain                   # a folder of .md files (+ optional .edges.json sidecars)
vitrus import-obsidian ./vault          # an Obsidian vault ([[wikilinks]] → typed edges)
vitrus import-notion ./export           # a Notion markdown export
vitrus import-chat conversations.json   # a ChatGPT or Claude export
vitrus import-gbrain ./gbrain           # migrate from GBrain
```

The connector framework is in the core (Apache-2.0): one interface (`fetch()` → records with **content +
ACL**), idempotent ingest, incremental prune, and **permission capture on every sync** — remove
someone from a channel and their access is revoked on the next sync, automatically.

**Seven first-class live connectors** over one injectable, mock-testable HTTP layer (5 pagination
styles — REST-Link · GET-cursor · POST-cursor · GraphQL · offset · pageToken): **GitHub · Slack ·
Notion · Linear · Jira · Drive · Gmail**. Incremental sync (`--since`, prune-safe), **webhook → live
delta** (GitHub direct; Slack triggers a re-sync), and a **durable, crash-recovery sync queue** with a
cron scheduler. Plus offline adapters: **Email** (participants become the ACL) · **Calendar** · a
generic **Docs** adapter · an **MCP-source bridge** (any MCP server becomes a source). And **eight
one-token presets** on the generic REST engine — **Stripe · HubSpot · Salesforce · Asana · Teams ·
Dropbox · Figma · Zoom** — pick one, paste a token, it syncs (no bespoke code). Everything funnels
into **one brain**, so the same `alice` mentioned in Slack and authoring a PR fuses into a single graph node.

```bash
GITHUB_TOKEN=… vitrus ingest github --live --repo owner/name              # pull (incremental with --since)
vitrus ingest slack --live --channel C0… --queue                          # enqueue a durable sync job
```

## Capabilities

- **Gap analysis** — five deterministic kinds: *missing* (referenced but undocumented), *contradiction*
  (conflicting edges), *stale* (superseded), *single-point* (bus-factor risk), *uncited* (event with no
  source). Derived from graph structure and explicit text signals only.
- **Proactive attention** — `vitrus watch` makes gap analysis *temporal*: *stale knowledge*, *unresolved
  incidents* and *aging gaps* surfaced **without being asked**. Deterministic, no LLM. Nightly
  `vitrus dream` consolidates (dedup, salience, **citation-fix** for uncited nodes, **contradiction
  digest**) and `vitrus brief` prints a morning briefing — a standing, self-maintaining radar over your memory.
- **Ops-map** — `vitrus ops` (MCP `ops_report`) reads the company as a system and flags operational
  inefficiencies: *unowned* services, *bus-factor* (single-person) risk, *bottlenecks* (overloaded hubs),
  *broken handoffs* (depending on superseded ground), and *redundant tools* (embedding-similar services).
  Severity-ranked, each finding cites real nodes — evidence, not a consultant's guess.
- **Conflict resolution** — `vitrus conflicts` / `vitrus resolve` (MCP `resolve_conflict`) detects
  contradictions and shows **both sides**; resolve by choosing the winner — the loser is superseded
  (marked stale) and the conflict closes. Nothing overwritten in silence.
- **Write-back loop** — agents **read before they act and write after they decide**: MCP
  `record_decision` / `capture_session` + `vitrus decide` + `vitrus hooks install` (Claude/Cursor/Codex).
  Decisions persist with their sources, so the brain stays live; a decision that contradicts an existing
  one is flagged back to the agent.
- **Self-linking graph** — `[[type::slug]]` typed edges, extracted without an LLM; **bi-temporal** —
  `vitrus dashboard --graph --asof <ISO>` (and `getConnections`/`graphSnapshot`) answer *"what did we
  believe in March?"* (time-travel on the edge graph; correct from real `created_at`/`expired_at`).
- **Schema packs** — a loadable taxonomy (`vitrus-base`): `vitrus schema lint` flags nodes/edges that
  violate the type model (unknown types, illegal edge endpoints); `vitrus schema explain <type>` documents
  a type and the edges it can participate in. Keeps a large brain's taxonomy honest.
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

Agents **read before they act and write after they decide.** Read tools: `search` · `think` ·
`gap_report` · `ops_report` · `provenance` · `verify`. Write tools: `record_decision` ·
`capture_session` · `resolve_conflict` (`remember` / `forget` / `improve` too). One command wires the
loop into Claude Code / Cursor / Codex: `vitrus hooks install`. Markdown sources are exposed as
`vitrus://node/<slug>` resources. Agents see **only what the token's user is allowed to see** — ACL is
enforced at the index layer, fail-closed. The output of an import can also be an executable
**Agent Skill (SKILL.md)** wired live to MCP.

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
  core/     @vitrus/core — engine, hybrid search, gap analysis, CLI, connectors (Apache-2.0)
    src/        the engine and CLI source (Bun runs TS directly, no build)
    brain/      a sample brain you can `vitrus import`
    migrations/ schema + row-level security
    test/       the test + eval + leak-test suites
  mcp/      @vitrus/mcp — the Model Context Protocol server (Apache-2.0)
docs/       the guides linked above
examples/   runnable recipes
assets/     logo + icon
```

This repo is the **open core**: everything above is Apache-2.0 licensed and self-hostable end-to-end, with no feature
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

There is also a hosted version at **[app.vitrus.dev](https://app.vitrus.dev)** — the same Apache-2.0 engine
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

## Vitrus Enterprise

For **regulated, on-prem and air-gapped** deployments — governments, **municipalities**, factories — there is
**[Vitrus Enterprise](https://github.com/ahmetvural79/vitrus-enterprise-info)**, which extends this open engine to
**relational databases** (MySQL/Postgres) and **ERP systems (SAP, Canias)** without modifying it. The thesis is preserved on structured data:
*the LLM proposes, a deterministic guard decides — and it shows the gap instead of bluffing.*

- **Text-to-SQL with a deterministic anti-hallucination guard** — NL question → candidate `SELECT` → an LLM-free
  guard (single-statement · read-only/SELECT-only · no unknown tables/columns · PII policy · mandatory limit) →
  read-only execution → answer **+ provenance**. Can't answer safely → an honest gap, not a confident wrong number.
- **Verified-query memory** — confirmed `question → SQL` pairs become deterministic, auditable few-shot memory, so
  accuracy compounds over time (only guard-passed queries are remembered).
- **Governed MCP for agents** — an MCP server exposes the SQL brain (`sql_ask`, `sql_run`, `list_tables`,
  `verify_claim`, `teach_query`) with the guard, row-level security, column masking, and audit enforced **inside
  every tool**, so Claude / Cursor / Codex / OpenClaw agents query governed data without bypassing it. stdio + HTTP.
- **Structured glass-box** — deterministic data-quality gaps (orphan FKs, stale rows, missing PKs), claim
  verification with evidence, full provenance, and a KVKK/GDPR audit trail with PII masking.
- **Fully local & air-gapped** — local LLM (Ollama/Gemma) + local embedder (BGE-M3/Qwen3); data never leaves the
  building. One-command `docker compose`, or an air-gapped USB bundle.
- **Modern white-label console** — a single-tenant **dark** dashboard over your existing databases, connected
  **read-only by construction** (SELECT-only user · read-only transaction · statement timeout · AST guard), with
  deterministic client-side charts (zero code execution) and suggested starter / follow-up questions.
- **ERP & connectors** — MSSQL / Oracle / SAP HANA drivers for **SAP** (S/4HANA via HANA SQL & CDS; ECC via a
  read-only replica) and **Canias**, plus token-REST connectors (GitHub, GitLab, Jira, Notion, Zendesk, Stripe, Salesforce…).

The core in this repository stays open; Enterprise is the commercial layer built on top.
Details → **[vitrus-enterprise-info](https://github.com/ahmetvural79/vitrus-enterprise-info)**.

## Contributing

Issues and PRs welcome — the [roadmap](https://github.com/ahmetvural79/Vitrus/issues) is real deferred
work, openly tracked. See [CONTRIBUTING.md](./CONTRIBUTING.md) and the
[security policy](./SECURITY.md). The fastest way to help: try the quickstart, and file an issue for
anything that didn't take 60 seconds.

## License + credit

`@vitrus/core` and `@vitrus/mcp` are **Apache-2.0** (see [LICENSE](./LICENSE)). The cloud apps (dashboard,
multi-tenant API) live in a separate non-public repo.

Vitrus draws on ideas explored by [GBrain](https://github.com/garrytan/gbrain) — Markdown-canonical
memory and an LLM-free typed graph — implemented independently here with its own engine and a
different emphasis: the gap box. If GBrain's shape fits you better, use it; honest memory winning in
any form is the point.

<div align="center">

**[vitrus.dev](https://vitrus.dev)** · **[live demo](https://vitrus.dev#demo)** · **[cloud dashboard](https://app.vitrus.dev)**

*Built for teams that want to trust their answers.*

</div>
