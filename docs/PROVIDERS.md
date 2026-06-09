# Providers

Vitrus is **offline-deterministic by default** — no API key, reproducible results (used by the eval
and leak-test gates). Plug in real models through the same interfaces whenever you want, via env vars.
`vitrus doctor` prints what resolved (and never prints secrets).

## The three pluggable roles

| Role | Interface | Default (offline) | Production |
| --- | --- | --- | --- |
| **Embedder** | `Embedder` | `HashingEmbedder` (deterministic, 1536-dim) | `OpenAIEmbedder` (multilingual `text-embedding-3-small`) or Ollama |
| **Synthesizer** | `Synthesizer` | `ExtractiveSynthesizer` (no LLM) | `LLMSynthesizer` (OpenAI / any chat model) |
| **Reranker** | `Reranker` | none (RRF order) | optional cross-encoder |

All three are selected by `*FromEnv` resolvers (`embedderFromEnv`, `synthesizerFromEnv`,
`rerankerFromEnv`, `engineFromEnv`).

## Quick switches

```bash
# Multilingual embeddings + LLM synthesis (ask in Turkish, hit an English doc)
export VITRUS_EMBED_PROVIDER=openai
export OPENAI_API_KEY=sk-...
vitrus think "veritabanı yedekleme politikası nedir"

# Model routing: easy → extractive (free), hard → LLM
export VITRUS_SYNTH_ROUTE=1
```

## Why offline-default matters

- **Reproducible gates.** `bun run eval` and `bun run leak-test` must be deterministic; a hashing
  embedder makes them so.
- **Zero-cost graph + gaps.** Graph building (`[[type::slug]]`) and gap analysis never call a model —
  they're pure text/structure operations. Providers only affect *embedding* and *answer phrasing*.
- **Privacy.** Nothing leaves your machine until you set a key.

## Multilingual note

Cross-lingual retrieval (query language ≠ document language) comes from the **embedder**, not keyword
search — PGLite has no stemmer/unaccent, so the vector signal carries morphology and cross-lingual
matching. Set a multilingual embedder (`OpenAIEmbedder`) for mixed-language brains. The synthesized
answer follows the query language (`ThinkResult.lang`).

## Env back-compat

Older `GLASSBOX_*` / `LUCIDEX_*` variables are still read and mapped to `VITRUS_*` via `normalizeEnv`,
so existing setups keep working.

## Embedding dimension

Default is **1536**. If you swap to an embedder with a different dimension, update the migration
(`migrations/0001_init.sql`) and `core/types.ts` together, then re-import.
