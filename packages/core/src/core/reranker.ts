// src/core/reranker.ts
// Reranker katmanı (gbrain paritesi). Hibrit aramanın aday kümesini cross-encoder ile
// YENİDEN SIRALAR — vektör+BM25'in kaçırdığı ince ilgililiği yakalar. Embedder/Synthesizer
// gibi DEĞİŞTİRİLEBİLİR ve VARSAYILAN KAPALI: VITRUS_RERANK_PROVIDER verilmedikçe
// rerankerFromEnv undefined döner → search/eval/bench davranışı bit-bit aynı kalır.
//
// Vektör şemasına DOKUNMAZ (boyuttan bağımsız) → çok-sağlayıcı embedding kısıtı yok.
// Yeni bağımlılık yok: düz fetch (OpenAIEmbedder deseni), test için enjekte edilebilir.

import type { FetchLike } from "./openai-embedder.js";
import { normalizeEnv } from "./env.js";

/** Tek aday: motor düğüm id'si + reranker'a verilecek metin. */
export interface RerankDoc {
  id: string;
  text: string;
}

export interface Reranker {
  /** docs'u query'ye göre yeniden sırala; en iyi ≤topK {id, score} (desc) döndür. */
  rerank(query: string, docs: RerankDoc[], topK: number): Promise<{ id: string; score: number }[]>;
}

// ---------------------------------------------------------------------------
// Offline deterministik reranker (dev/test + air-gapped seçenek). Token örtüşmesi
// (Jaccard benzeri) — ağ/anahtar yok. Üretimde cross-encoder sağlayıcı takılır.
// ---------------------------------------------------------------------------

function toks(s: string): Set<string> {
  return new Set(
    s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 2)
  );
}

export class LexicalReranker implements Reranker {
  async rerank(query: string, docs: RerankDoc[], topK: number): Promise<{ id: string; score: number }[]> {
    const q = toks(query);
    if (q.size === 0) return docs.slice(0, topK).map((d) => ({ id: d.id, score: 0 }));
    return docs
      .map((d) => {
        const dt = toks(d.text);
        let overlap = 0;
        for (const t of q) if (dt.has(t)) overlap++;
        return { id: d.id, score: Number((overlap / q.size).toFixed(4)) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}

// ---------------------------------------------------------------------------
// HTTP cross-encoder rerankerları (Cohere / Voyage / ZeroEntropy). Tümü
// {index, relevance_score} listesi döndürür; preset alan adlarını soyutlar.
// ---------------------------------------------------------------------------

interface RerankPreset {
  baseUrl: string;
  defaultModel: string;
  topParam: "top_n" | "top_k";
  resultsKey: "results" | "data";
}

const PRESETS: Record<"cohere" | "voyage" | "zeroentropy", RerankPreset> = {
  cohere: { baseUrl: "https://api.cohere.com/v2/rerank", defaultModel: "rerank-v3.5", topParam: "top_n", resultsKey: "results" },
  voyage: { baseUrl: "https://api.voyageai.com/v1/rerank", defaultModel: "rerank-2.5", topParam: "top_k", resultsKey: "data" },
  zeroentropy: { baseUrl: "https://api.zeroentropy.dev/v1/models/rerank", defaultModel: "zerank-1", topParam: "top_n", resultsKey: "results" },
};

export interface HttpRerankerOpts {
  apiKey: string;
  preset: RerankPreset;
  model?: string;
  fetchImpl?: FetchLike;
}

interface RerankResponse {
  results?: { index: number; relevance_score: number }[];
  data?: { index: number; relevance_score: number }[];
}

export class HttpReranker implements Reranker {
  private readonly apiKey: string;
  private readonly preset: RerankPreset;
  private readonly model: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: HttpRerankerOpts) {
    if (!opts.apiKey) throw new Error("HttpReranker: apiKey required");
    this.apiKey = opts.apiKey;
    this.preset = opts.preset;
    this.model = opts.model ?? opts.preset.defaultModel;
    const globalFetch = (globalThis as { fetch?: unknown }).fetch as FetchLike | undefined;
    const fetchImpl = opts.fetchImpl ?? globalFetch;
    if (!fetchImpl) throw new Error("HttpReranker: no fetch available (pass fetchImpl)");
    this.fetchImpl = fetchImpl;
  }

  async rerank(query: string, docs: RerankDoc[], topK: number): Promise<{ id: string; score: number }[]> {
    if (docs.length === 0) return [];
    const body: Record<string, unknown> = {
      model: this.model,
      query,
      documents: docs.map((d) => d.text),
    };
    body[this.preset.topParam] = Math.min(topK, docs.length);

    const res = await this.fetchImpl(this.preset.baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HttpReranker: HTTP ${res.status} — ${await res.text()}`);
    const json = (await res.json()) as RerankResponse;
    const results = json[this.preset.resultsKey] ?? [];
    return results
      .filter((r) => r.index >= 0 && r.index < docs.length)
      .map((r) => ({ id: docs[r.index].id, score: r.relevance_score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}

/**
 * Reranker factory. VARSAYILAN KAPALI: VITRUS_RERANK_PROVIDER yoksa undefined döner
 * (search/eval/bench değişmez). Sağlayıcı ∈ cohere | voyage | zeroentropy | lexical.
 */
export function rerankerFromEnv(rawEnv: Record<string, string | undefined> = process.env): Reranker | undefined {
  const env = normalizeEnv(rawEnv);
  const provider = (env.VITRUS_RERANK_PROVIDER ?? "").toLowerCase();
  if (!provider) return undefined;
  const model = env.VITRUS_RERANK_MODEL;
  switch (provider) {
    case "lexical":
      return new LexicalReranker();
    case "cohere": {
      const key = env.COHERE_API_KEY;
      if (!key) throw new Error("rerankerFromEnv: provider=cohere requires COHERE_API_KEY");
      return new HttpReranker({ apiKey: key, preset: PRESETS.cohere, model });
    }
    case "voyage": {
      const key = env.VOYAGE_API_KEY;
      if (!key) throw new Error("rerankerFromEnv: provider=voyage requires VOYAGE_API_KEY");
      return new HttpReranker({ apiKey: key, preset: PRESETS.voyage, model });
    }
    case "zeroentropy": {
      const key = env.ZEROENTROPY_API_KEY;
      if (!key) throw new Error("rerankerFromEnv: provider=zeroentropy requires ZEROENTROPY_API_KEY");
      return new HttpReranker({ apiKey: key, preset: PRESETS.zeroentropy, model });
    }
    default:
      throw new Error(`rerankerFromEnv: unknown VITRUS_RERANK_PROVIDER="${provider}" (cohere|voyage|zeroentropy|lexical)`);
  }
}

/** Over-fetch faktörü: reranker açıkken hibrit aramadan kaç kat aday çekilir (≤50 cap). */
export const RERANK_POOL_FACTOR = 4;
