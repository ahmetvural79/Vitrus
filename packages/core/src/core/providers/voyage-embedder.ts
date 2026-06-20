// src/core/providers/voyage-embedder.ts
// Voyage AI embedder (voyage-3.5 / voyage-3-large). Çok-dilli, yüksek-kalite, Matryoshka:
// output_dimension ∈ {256,512,1024,2048}. Donmuş vector(1536) şeması için en küçük ≥1536
// desteklenen boyut (2048) istenir → fitDim ile 1536'ya truncate + l2normalize (Matryoshka-güvenli)
// → MİGRASYON GEREKMEZ. voyage-3.5 asimetrik: input_type ∈ document|query (opsiyonel).
// Yeni bağımlılık yok: düz fetch (OpenAIEmbedder deseni), test için enjekte edilebilir.

import type { Embedder } from "../engine.js";
import type { FetchLike } from "../openai-embedder.js";
import { l2normalize, fitDim } from "./common.js";

const DEFAULT_MODEL = "voyage-3.5";
const DEFAULT_DIM = 1536;
const DEFAULT_BASE = "https://api.voyageai.com/v1";
const SUPPORTED_DIMS = [256, 512, 1024, 2048]; // Voyage Matryoshka output_dimension değerleri

/** En küçük desteklenen ≥ target boyutu iste (sonra fitDim ile tam dim'e indir); yoksa en büyük. */
function outputDim(target: number): number {
  return SUPPORTED_DIMS.find((d) => d >= target) ?? SUPPORTED_DIMS[SUPPORTED_DIMS.length - 1];
}

export interface VoyageEmbedderOpts {
  apiKey: string;
  model?: string;
  /** Donmuş şema 1536; başka boyut için re-init + dim migration gerekir. */
  dim?: number;
  baseUrl?: string;
  /** "document" (indeksleme) | "query" (sorgu) | undefined (nötr). Voyage asimetrik embedding. */
  inputType?: string;
  fetchImpl?: FetchLike;
}

interface VoyageResponse {
  data: { index: number; embedding: number[] }[];
}

export class VoyageEmbedder implements Embedder {
  readonly dim: number;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly inputType?: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: VoyageEmbedderOpts) {
    if (!opts.apiKey) throw new Error("VoyageEmbedder: apiKey required");
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.dim = opts.dim ?? DEFAULT_DIM;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
    this.inputType = opts.inputType;
    const globalFetch = (globalThis as { fetch?: unknown }).fetch as FetchLike | undefined;
    const fetchImpl = opts.fetchImpl ?? globalFetch;
    if (!fetchImpl) throw new Error("VoyageEmbedder: no fetch available (pass fetchImpl)");
    this.fetchImpl = fetchImpl;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await this.fetchImpl(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        output_dimension: outputDim(this.dim),
        ...(this.inputType ? { input_type: this.inputType } : {}),
      }),
    });
    if (!res.ok) throw new Error(`VoyageEmbedder: HTTP ${res.status} — ${await res.text()}`);
    const json = (await res.json()) as VoyageResponse;
    // API sırayı karıştırabilir; index doğruluk kaynağı. Matryoshka → dim'e fit + normalize.
    return [...json.data]
      .sort((a, b) => a.index - b.index)
      .map((d) => l2normalize(fitDim(d.embedding, this.dim)));
  }
}
