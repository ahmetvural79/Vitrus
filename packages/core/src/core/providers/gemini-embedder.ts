// src/core/providers/gemini-embedder.ts
// Google Gemini embedder (gemini-embedding-001). Çok-dilli, Matryoshka:
// outputDimensionality ile 1536'ya inebilir → donmuş vector(1536) şemasıyla uyumlu,
// MİGRASYON GEREKMEZ. Truncated boyut normalize edilmeden döner → l2normalize.
// Yeni bağımlılık yok: düz fetch (OpenAIEmbedder deseni), test için enjekte edilebilir.

import type { Embedder } from "../engine.js";
import type { FetchLike } from "../openai-embedder.js";
import { l2normalize } from "./common.js";

const DEFAULT_MODEL = "gemini-embedding-001";
const DEFAULT_DIM = 1536;
const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiEmbedderOpts {
  apiKey: string;
  model?: string;
  /** Donmuş şema 1536; başka boyut için re-init + dim migration gerekir. */
  dim?: number;
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

interface BatchEmbedResponse {
  embeddings: { values: number[] }[];
}

export class GeminiEmbedder implements Embedder {
  readonly dim: number;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: GeminiEmbedderOpts) {
    if (!opts.apiKey) throw new Error("GeminiEmbedder: apiKey required");
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.dim = opts.dim ?? DEFAULT_DIM;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
    const globalFetch = (globalThis as { fetch?: unknown }).fetch as FetchLike | undefined;
    const fetchImpl = opts.fetchImpl ?? globalFetch;
    if (!fetchImpl) throw new Error("GeminiEmbedder: no fetch available (pass fetchImpl)");
    this.fetchImpl = fetchImpl;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const modelPath = this.model.startsWith("models/") ? this.model : `models/${this.model}`;
    const res = await this.fetchImpl(`${this.baseUrl}/${modelPath}:batchEmbedContents`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({
        requests: texts.map((t) => ({
          model: modelPath,
          // Boş/yalnız-boşluk içerik Gemini'de 400 verir → tek boşlukla ikame et (dirençli embed).
          content: { parts: [{ text: t && t.trim() ? t : " " }] },
          outputDimensionality: this.dim,
        })),
      }),
    });
    if (!res.ok) throw new Error(`GeminiEmbedder: HTTP ${res.status} — ${await res.text()}`);
    const json = (await res.json()) as BatchEmbedResponse;
    // Sıra korunur (batch yanıtı giriş sırasıyla eşlenir). Truncated dim → normalize.
    return json.embeddings.map((e) => l2normalize(e.values));
  }
}
