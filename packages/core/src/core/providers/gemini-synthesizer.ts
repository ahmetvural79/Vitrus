// src/core/providers/gemini-synthesizer.ts
// Google Gemini sentezleyici — generateContent. Cevap SORGU DİLİNDE, YALNIZ verilen
// hit'lerden, [n] ile kaynağa bağlı (citations [n] → usable[n-1] SABİT grounding).
// Yeni bağımlılık yok: düz fetch, test için enjekte edilebilir.

import type { SearchHit } from "../types.js";
import type { Synthesizer, Synthesis, SynthesizeOpts } from "../synthesizer.js";
import type { FetchLike } from "../openai-embedder.js";
import { selectUsable, notFound, citationsOf, buildPrompt } from "./common.js";

const DEFAULT_MODEL = "gemini-2.5-flash"; // çok-dilli, ucuz, hızlı
const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiSynthesizerOpts {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  maxFacts?: number;
}

interface GenerateResponse {
  candidates: { content: { parts: { text?: string }[] } }[];
}

export class GeminiSynthesizer implements Synthesizer {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly maxFacts: number;
  private readonly fetchImpl: FetchLike;

  constructor(opts: GeminiSynthesizerOpts) {
    if (!opts.apiKey) throw new Error("GeminiSynthesizer: apiKey required");
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
    this.maxFacts = opts.maxFacts ?? 5;
    const globalFetch = (globalThis as { fetch?: unknown }).fetch as FetchLike | undefined;
    const fetchImpl = opts.fetchImpl ?? globalFetch;
    if (!fetchImpl) throw new Error("GeminiSynthesizer: no fetch available (pass fetchImpl)");
    this.fetchImpl = fetchImpl;
  }

  async synthesize(query: string, hits: SearchHit[], opts: SynthesizeOpts = {}): Promise<Synthesis> {
    const usable = selectUsable(hits, this.maxFacts);
    if (usable.length === 0) return { answer: notFound(query, opts.lang), citations: [] };
    const { system, user } = buildPrompt(query, usable, opts.lang ?? "und");
    const modelPath = this.model.startsWith("models/") ? this.model : `models/${this.model}`;

    const res = await this.fetchImpl(`${this.baseUrl}/${modelPath}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature: 0 },
      }),
    });
    if (!res.ok) throw new Error(`GeminiSynthesizer: HTTP ${res.status} — ${await res.text()}`);
    const json = (await res.json()) as GenerateResponse;
    const answer = (json.candidates[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    return { answer, citations: citationsOf(usable) };
  }
}
