// src/core/providers/anthropic-synthesizer.ts
// Anthropic (Claude) sentezleyici — Messages API. Cevap SORGU DİLİNDE, YALNIZ verilen
// hit'lerden, [n] ile kaynağa bağlı (LLMSynthesizer ile aynı grounding sözleşmesi:
// citations [n] → usable[n-1] SABİT). Yeni bağımlılık yok: düz fetch, enjekte edilebilir.

import type { SearchHit } from "../types.js";
import type { Synthesizer, Synthesis, SynthesizeOpts } from "../synthesizer.js";
import type { FetchLike } from "../openai-embedder.js";
import { selectUsable, notFound, citationsOf, buildPrompt } from "./common.js";

const DEFAULT_MODEL = "claude-haiku-4-5"; // çok-dilli, ucuz, hızlı
const DEFAULT_BASE = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";

export interface AnthropicSynthesizerOpts {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  maxTokens?: number;
  fetchImpl?: FetchLike;
  maxFacts?: number;
}

interface MessagesResponse {
  content: { type: string; text?: string }[];
}

export class AnthropicSynthesizer implements Synthesizer {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly maxTokens: number;
  private readonly maxFacts: number;
  private readonly fetchImpl: FetchLike;

  constructor(opts: AnthropicSynthesizerOpts) {
    if (!opts.apiKey) throw new Error("AnthropicSynthesizer: apiKey required");
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
    this.maxTokens = opts.maxTokens ?? 1024;
    this.maxFacts = opts.maxFacts ?? 5;
    const globalFetch = (globalThis as { fetch?: unknown }).fetch as FetchLike | undefined;
    const fetchImpl = opts.fetchImpl ?? globalFetch;
    if (!fetchImpl) throw new Error("AnthropicSynthesizer: no fetch available (pass fetchImpl)");
    this.fetchImpl = fetchImpl;
  }

  async synthesize(query: string, hits: SearchHit[], opts: SynthesizeOpts = {}): Promise<Synthesis> {
    const usable = selectUsable(hits, this.maxFacts);
    if (usable.length === 0) return { answer: notFound(query, opts.lang), citations: [] };
    const { system, user } = buildPrompt(query, usable, opts.lang ?? "und");

    const res = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: 0,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) throw new Error(`AnthropicSynthesizer: HTTP ${res.status} — ${await res.text()}`);
    const json = (await res.json()) as MessagesResponse;
    const answer = json.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    return { answer, citations: citationsOf(usable) };
  }
}
