// src/core/openai-embedder.ts
// Multilingual production embedder (BYO). Cross-lingual retrieval — ask in Turkish,
// retrieve English sources and vice versa — comes from a multilingual embedding model,
// NOT from keyword search (PGLite has no Turkish stemmer and no `unaccent`). This is
// the real lever for a language-agnostic brain.
//
// Default model: text-embedding-3-small — multilingual, native 1536 dims, so it matches
// the frozen `vector(1536)` schema with no migration. The offline-deterministic
// HashingEmbedder stays the dev/eval default; OpenAIEmbedder kicks in when an API key is
// present (see embedderFromEnv).
//
// No new dependency: plain fetch, injectable for deterministic offline unit tests.

import type { Embedder } from "./engine.js";
import { normalizeEnv } from "./env.js";
import { HashingEmbedder } from "./hashing-embedder.js";
import { GeminiEmbedder } from "./providers/gemini-embedder.js";
import { CohereEmbedder } from "./providers/cohere-embedder.js";
import { VoyageEmbedder } from "./providers/voyage-embedder.js";
import { ZeroEntropyEmbedder } from "./providers/zeroentropy-embedder.js";

/** Minimal fetch shape we depend on — keeps DOM/Node lib typing out of the contract. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;

export interface OpenAIEmbedderOpts {
  apiKey: string;
  /** Default text-embedding-3-small (multilingual, 1536). */
  model?: string;
  /** Must match the schema vector dim (1536). Larger models need a migration. */
  dim?: number;
  /** Default https://api.openai.com/v1 (override for Azure/proxy/Ollama-compatible). */
  baseUrl?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: FetchLike;
}

const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_DIM = 1536;
const DEFAULT_BASE = "https://api.openai.com/v1";

interface EmbeddingResponse {
  data: { index: number; embedding: number[] }[];
}

export class OpenAIEmbedder implements Embedder {
  readonly dim: number;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: OpenAIEmbedderOpts) {
    if (!opts.apiKey) throw new Error("OpenAIEmbedder: apiKey required");
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.dim = opts.dim ?? DEFAULT_DIM;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
    const globalFetch = (globalThis as { fetch?: unknown }).fetch as FetchLike | undefined;
    const fetchImpl = opts.fetchImpl ?? globalFetch;
    if (!fetchImpl) throw new Error("OpenAIEmbedder: no fetch available (pass fetchImpl)");
    this.fetchImpl = fetchImpl;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await this.fetchImpl(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, input: texts, dimensions: this.dim }),
    });
    if (!res.ok) throw new Error(`OpenAIEmbedder: HTTP ${res.status} — ${await res.text()}`);
    const json = (await res.json()) as EmbeddingResponse;
    // The API may return embeddings out of order; `index` is the source of truth.
    return [...json.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}

/**
 * Production-default embedder factory with multi-provider dispatch.
 *
 * `VITRUS_EMBED_PROVIDER` ∈ openai | gemini | cohere | voyage | zeroentropy | hashing selects the provider;
 * all default to the frozen vector(1536) dim (no migration). When unset, backward-compat:
 * OPENAI_API_KEY → OpenAIEmbedder, else the offline-deterministic HashingEmbedder (so dev,
 * eval and leak-test stay reproducible and air-gapped). `VITRUS_EMBED_DIM` overrides the
 * dim (requires re-init + a matching schema; see migrations note).
 */
export function embedderFromEnv(rawEnv: Record<string, string | undefined> = process.env): Embedder {
  const env = normalizeEnv(rawEnv);
  const provider = (env.VITRUS_EMBED_PROVIDER ?? "").toLowerCase();
  const dim = env.VITRUS_EMBED_DIM ? Number(env.VITRUS_EMBED_DIM) : undefined;
  const model = env.VITRUS_EMBED_MODEL;

  switch (provider) {
    case "hashing":
      return new HashingEmbedder();
    case "gemini": {
      const key = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY;
      if (!key) throw new Error("embedderFromEnv: provider=gemini requires GEMINI_API_KEY");
      return new GeminiEmbedder({ apiKey: key, model, dim, baseUrl: env.GEMINI_BASE_URL });
    }
    case "cohere": {
      const key = env.COHERE_API_KEY;
      if (!key) throw new Error("embedderFromEnv: provider=cohere requires COHERE_API_KEY");
      return new CohereEmbedder({ apiKey: key, model, dim, baseUrl: env.COHERE_BASE_URL, inputType: env.VITRUS_COHERE_INPUT_TYPE });
    }
    case "voyage": {
      const key = env.VOYAGE_API_KEY;
      if (!key) throw new Error("embedderFromEnv: provider=voyage requires VOYAGE_API_KEY");
      return new VoyageEmbedder({ apiKey: key, model, dim, baseUrl: env.VOYAGE_BASE_URL, inputType: env.VITRUS_VOYAGE_INPUT_TYPE });
    }
    case "zeroentropy": {
      const key = env.ZEROENTROPY_API_KEY;
      if (!key) throw new Error("embedderFromEnv: provider=zeroentropy requires ZEROENTROPY_API_KEY");
      return new ZeroEntropyEmbedder({ apiKey: key, model, dim, baseUrl: env.ZEROENTROPY_BASE_URL, inputType: env.VITRUS_ZE_INPUT_TYPE, latency: env.VITRUS_ZE_LATENCY });
    }
    case "openai":
    case "": {
      // Default path (provider unset): OPENAI_API_KEY → OpenAI, else offline hashing.
      const key = env.OPENAI_API_KEY;
      if (!key) {
        if (provider === "openai") throw new Error("embedderFromEnv: provider=openai requires OPENAI_API_KEY");
        return new HashingEmbedder();
      }
      return new OpenAIEmbedder({ apiKey: key, model, dim, baseUrl: env.OPENAI_BASE_URL });
    }
    default:
      throw new Error(`embedderFromEnv: unknown VITRUS_EMBED_PROVIDER="${provider}" (openai|gemini|cohere|voyage|zeroentropy|hashing)`);
  }
}
