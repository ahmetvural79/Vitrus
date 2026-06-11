# Changelog

All notable changes to `@vitrus/core` and `@vitrus/mcp`. Format loosely follows
[Keep a Changelog](https://keepachangelog.com); this project uses date-based releases.

## [Unreleased]

### Added
- **`@vitrus/core/verify` subpath export** — `verifyClaim(engine, claim)` is now importable directly
  (deterministic grounded/stale/contradicted/unsupported verdicts), so hosts can fact-check agent
  claims programmatically without going through the MCP tool.

### Changed
- **README restructured** — community-first narrative (install paths, query modes, capabilities,
  troubleshooting), a factual *Vitrus Cloud* section describing the hosted dashboard/connectors/MCP
  endpoint, and a credit note to GBrain. Pricing/comparison marketing removed from the repo.

## [0.3.0] — 2026-06

### Added
- **Proactive attention layer** — `vitrus attention` / `vitrus watch`. Deterministic, time-aware
  surfacing of stale knowledge, unresolved incidents, and aging gaps (`computeAttention`, no LLM).
- **English-default output** — CLI/answer strings default to English; answers still follow the query
  language (`ThinkResult.lang`) for multilingual brains.
- **Docs set** — Quickstart, Architecture, CLI reference, Providers, Scaling, MCP, plus runnable
  Examples.
- **Env back-compat** — `normalizeEnv` maps legacy `GLASSBOX_*` / `LUCIDEX_*` variables to `VITRUS_*`.

### Changed
- **Rebranded to Vitrus** — package names `@vitrus/core` / `@vitrus/mcp`; binaries `vitrus` /
  `vitrus-mcp`.

## [0.2.0]

### Added
- **Multi-tenant isolation** — org-scoped engine with index-layer filtering and Postgres row-level
  security (migrations `0005`/`0006`); cross-tenant read = 0 (hard gate).
- **Bi-temporal edges** — edges carry validity windows; "what did we believe then" is answerable.
- **Verify** — `vitrus verify` / MCP `verify`: deterministic grounded / stale / contradicted /
  unsupported verdicts.
- **Skill lifecycle** — `skill-curate`, `skill-optimize`, frozen `skill-eval` regression gate.

## [0.1.0]

### Added
- **The engine** — one `BrainEngine` contract over `SqlDriver` (PGLite and Postgres+pgvector).
- **Hybrid search** — vector (pgvector) + BM25 + entity, fused with Reciprocal Rank Fusion (k=60).
- **Self-linking graph** — `[[type::slug]]` wiki-links become typed edges with no LLM call.
- **Deterministic gap analysis** — missing / contradiction / stale / single-point / uncited.
- **MCP server** — stdio + Streamable HTTP; `search`, `think`, `gap_report`, `provenance`,
  `get_node`, `verify`.
- **Skill packs** — `SKILL.md` export in the open Agent Skills format.
- **Offline-deterministic providers** — `HashingEmbedder` + `ExtractiveSynthesizer` for reproducible
  gates; OpenAI/Ollama plug in through the same interfaces.
