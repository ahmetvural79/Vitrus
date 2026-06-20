// src/core/providers/zeroentropy-embedder.ts
// ZeroEntropy embedder (zembed-1). Çok-dilli, Matryoshka: dimensions ∈ {40,80,160,320,640,1280,2560}.
// Donmuş vector(1536) için en küçük ≥1536 desteklenen boyut (2560) istenir → fitDim ile 1536'ya
// truncate + l2normalize (Matryoshka-güvenli) → MİGRASYON GEREKMEZ. Asimetrik: input_type ∈ query|document.
// API tabanı reranker ile aynı: POST /v1/models/embed, Bearer auth, response.results[i].embedding (sıralı).
// Yeni bağımlılık yok: düz fetch (OpenAIEmbedder deseni), test için enjekte edilebilir.

import type { Embedder } from "../engine.js";
import type { FetchLike } from "../openai-embedder.js";
import { l2normalize, fitDim } from "./common.js";

const DEFAULT_MODEL = "zembed-1";
const DEFAULT_DIM = 1536;
const DEFAULT_BASE = "https://api.zeroentropy.dev/v1";
const SUPPORTED_DIMS = [40, 80, 160, 320, 640, 1280, 2560]; // zembed-1 Matryoshka boyutları

/** En küçük desteklenen ≥ target boyutu iste (sonra fitDim ile tam dim'e indir); yoksa en büyük. */
function outputDim(target: number): number {
  return SUPPORTED_DIMS.find((d) => d >= target) ?? SUPPORTED_DIMS[SUPPORTED_DIMS.length - 1];
}

export interface ZeroEntropyEmbedderOpts {
  apiKey: string;
  model?: string;
  /** Donmuş şema 1536; başka boyut için re-init + dim migration gerekir. */
  dim?: number;
  baseUrl?: string;
  /** "query" | "document" (asimetrik retrieval). Opsiyonel. */
  inputType?: string;
  /** "fast" (gerçek-zaman) | "slow" (batch). Opsiyonel. */
  latency?: string;
  fetchImpl?: FetchLike;
}

interface ZeResponse {
  results: { index?: number; embedding: number[] }[];
}

export class ZeroEntropyEmbedder implements Embedder {
  readonly dim: number;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly inputType?: string;
  private readonly latency?: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: ZeroEntropyEmbedderOpts) {
    if (!opts.apiKey) throw new Error("ZeroEntropyEmbedder: apiKey required");
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.dim = opts.dim ?? DEFAULT_DIM;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
    this.inputType = opts.inputType;
    this.latency = opts.latency;
    const globalFetch = (globalThis as { fetch?: unknown }).fetch as FetchLike | undefined;
    const fetchImpl = opts.fetchImpl ?? globalFetch;
    if (!fetchImpl) throw new Error("ZeroEntropyEmbedder: no fetch available (pass fetchImpl)");
    this.fetchImpl = fetchImpl;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await this.fetchImpl(`${this.baseUrl}/models/embed`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        dimensions: outputDim(this.dim),
        ...(this.inputType ? { input_type: this.inputType } : {}),
        ...(this.latency ? { latency: this.latency } : {}),
      }),
    });
    if (!res.ok) throw new Error(`ZeroEntropyEmbedder: HTTP ${res.status} — ${await res.text()}`);
    const json = (await res.json()) as ZeResponse;
    // results sıralı döner; index varsa savunmacı olarak ona göre sırala. Matryoshka → dim'e fit + normalize.
    const ordered = json.results.some((r) => typeof r.index === "number")
      ? [...json.results].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      : json.results;
    return ordered.map((r) => l2normalize(fitDim(r.embedding, this.dim)));
  }
}
