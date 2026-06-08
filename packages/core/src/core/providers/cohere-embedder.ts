// src/core/providers/cohere-embedder.ts
// Cohere embedder (embed-v4.0). Çok-dilli (100+ dil), output_dimension ∈ {256,512,1024,1536}
// → 1536 native, donmuş vector(1536) şemasıyla MİGRASYON GEREKMEZ.
// Embedder arayüzü query/doc ayrımı taşımaz; input_type env ile (varsayılan search_document).
// Yeni bağımlılık yok: düz fetch, test için enjekte edilebilir.

import type { Embedder } from "../engine.js";
import type { FetchLike } from "../openai-embedder.js";
import { l2normalize } from "./common.js";

const DEFAULT_MODEL = "embed-v4.0";
const DEFAULT_DIM = 1536;
const DEFAULT_BASE = "https://api.cohere.com/v2";

export interface CohereEmbedderOpts {
  apiKey: string;
  model?: string;
  dim?: number;
  baseUrl?: string;
  /** "search_document" (varsayılan) | "search_query". Embedder arayüzü ayrım taşımaz. */
  inputType?: string;
  fetchImpl?: FetchLike;
}

interface CohereEmbedResponse {
  embeddings: { float: number[][] };
}

export class CohereEmbedder implements Embedder {
  readonly dim: number;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly inputType: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: CohereEmbedderOpts) {
    if (!opts.apiKey) throw new Error("CohereEmbedder: apiKey required");
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.dim = opts.dim ?? DEFAULT_DIM;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
    this.inputType = opts.inputType ?? "search_document";
    const globalFetch = (globalThis as { fetch?: unknown }).fetch as FetchLike | undefined;
    const fetchImpl = opts.fetchImpl ?? globalFetch;
    if (!fetchImpl) throw new Error("CohereEmbedder: no fetch available (pass fetchImpl)");
    this.fetchImpl = fetchImpl;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await this.fetchImpl(`${this.baseUrl}/embed`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        texts,
        input_type: this.inputType,
        output_dimension: this.dim,
        embedding_types: ["float"],
      }),
    });
    if (!res.ok) throw new Error(`CohereEmbedder: HTTP ${res.status} — ${await res.text()}`);
    const json = (await res.json()) as CohereEmbedResponse;
    return json.embeddings.float.map((v) => l2normalize(v));
  }
}
