// src/core/llm-synthesizer.ts
// BYO LLM sentezleyici — cevabı SORGU DİLİNDE, YALNIZ verilen hit'lerden, [n] ile
// kaynağa bağlı üretir (L2: "cevap sorgu dilini izler"). ExtractiveSynthesizer kaynak
// cümleyi olduğu gibi alır (çeviremez); LLM sentezleyici hedef dilde yeniden ifade eder.
//
// Glass-box korunur: citations [n] → verilen hit'lere SABİT eşlenir (modelin uydurması
// engellenir; "yalnız numaralı kaynaklardan, her iddiayı [n] ile" talimatı). fetch
// enjekte edilebilir → offline test. Anahtar yoksa ExtractiveSynthesizer (synthesizerFromEnv).
// Yeni bağımlılık yok: düz fetch (OpenAIEmbedder ile aynı desen).

import type { SearchHit } from "./types.js";
import type { Synthesizer, Synthesis, SynthesizeOpts } from "./synthesizer.js";
import { ExtractiveSynthesizer } from "./synthesizer.js";
import { RoutingSynthesizer } from "./routing-synthesizer.js";
import type { FetchLike } from "./openai-embedder.js";
import { AnthropicSynthesizer } from "./providers/anthropic-synthesizer.js";
import { normalizeEnv } from "./env.js";
import { GeminiSynthesizer } from "./providers/gemini-synthesizer.js";

const DEFAULT_MODEL = "gpt-4o-mini"; // çok-dilli, ucuz
const DEFAULT_BASE = "https://api.openai.com/v1";

export interface LLMSynthesizerOpts {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  maxFacts?: number;
}

interface ChatResponse {
  choices: { message: { content: string } }[];
}

function notFound(query: string, lang?: string): string {
  return lang === "en"
    ? `No sourced content found in the brain for "${query}".`
    : `"${query}" için beyinde kaynaklı içerik bulunamadı.`;
}

export class LLMSynthesizer implements Synthesizer {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly maxFacts: number;

  constructor(opts: LLMSynthesizerOpts) {
    if (!opts.apiKey) throw new Error("LLMSynthesizer: apiKey required");
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
    this.maxFacts = opts.maxFacts ?? 5;
    const globalFetch = (globalThis as { fetch?: unknown }).fetch as FetchLike | undefined;
    const fetchImpl = opts.fetchImpl ?? globalFetch;
    if (!fetchImpl) throw new Error("LLMSynthesizer: no fetch available (pass fetchImpl)");
    this.fetchImpl = fetchImpl;
  }

  async synthesize(query: string, hits: SearchHit[], opts: SynthesizeOpts = {}): Promise<Synthesis> {
    const usable = hits.filter((h) => h.node.content.trim().length > 0).slice(0, this.maxFacts);
    if (usable.length === 0) return { answer: notFound(query, opts.lang), citations: [] };

    // citations [n] → usable[n-1] SABİT eşleme (grounding garantisi; model uyduramaz).
    const citations = usable.map((h) => ({ nodeId: h.node.id, slug: h.node.slug, uri: h.node.provenance.uri }));
    const sources = usable.map((h, i) => `[${i + 1}] ${h.node.slug}\n${h.node.content.slice(0, 800)}`).join("\n\n");
    const lang = opts.lang ?? "und";

    const system =
      `You are Vitrus's answer synthesizer. Answer ONLY from the numbered sources below. ` +
      `Cite every claim with its [n] marker. Never invent facts not in the sources. ` +
      `Write the answer in the language with code "${lang}" (the user's query language); if "und", match the query's language.`;
    const user = `Query: ${query}\n\nSources:\n${sources}`;

    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0,
      }),
    });
    if (!res.ok) throw new Error(`LLMSynthesizer: HTTP ${res.status} — ${await res.text()}`);
    const json = (await res.json()) as ChatResponse;
    const answer = json.choices[0]?.message?.content ?? "";
    return { answer, citations };
  }
}

/**
 * Production-default synthesizer factory with multi-provider dispatch.
 *
 * `VITRUS_SYNTH_PROVIDER` ∈ openai | anthropic | gemini | ollama | extractive selects the
 * "strong" synthesizer (answer follows the query language; citations stay [n]→source bound).
 * When unset, backward-compat: OPENAI_API_KEY → OpenAI LLMSynthesizer, else offline
 * ExtractiveSynthesizer. `VITRUS_LLM_SYNTH="0"` forces extractive (eval/test always use it
 * directly). `VITRUS_SYNTH_ROUTE="1"` wraps the strong synth so easy queries stay cheap.
 */
export function synthesizerFromEnv(rawEnv: Record<string, string | undefined> = process.env): Synthesizer {
  const env = normalizeEnv(rawEnv);
  if (env.VITRUS_LLM_SYNTH === "0") return new ExtractiveSynthesizer();
  const strong = strongSynthesizerFromEnv(env);
  if (!strong) return new ExtractiveSynthesizer();
  // D2: routing açıksa kolay sorgular ucuz (extractive, sıfır token), zor sorgular güçlü LLM.
  if (env.VITRUS_SYNTH_ROUTE === "1") return new RoutingSynthesizer(new ExtractiveSynthesizer(), strong);
  return strong;
}

/** Güçlü (LLM) sentezleyiciyi sağlayıcıdan kur; null = offline extractive'e düş. */
function strongSynthesizerFromEnv(env: Record<string, string | undefined>): Synthesizer | null {
  const provider = (env.VITRUS_SYNTH_PROVIDER ?? "").toLowerCase();
  const model = env.VITRUS_SYNTH_MODEL;
  switch (provider) {
    case "extractive":
      return null;
    case "anthropic": {
      const key = env.ANTHROPIC_API_KEY;
      if (!key) throw new Error("synthesizerFromEnv: provider=anthropic requires ANTHROPIC_API_KEY");
      return new AnthropicSynthesizer({ apiKey: key, model, baseUrl: env.ANTHROPIC_BASE_URL });
    }
    case "gemini": {
      const key = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY;
      if (!key) throw new Error("synthesizerFromEnv: provider=gemini requires GEMINI_API_KEY");
      return new GeminiSynthesizer({ apiKey: key, model, baseUrl: env.GEMINI_BASE_URL });
    }
    case "ollama":
      // OpenAI-uyumlu /v1/chat/completions (yerel, anahtarsız, gizlilik).
      return new LLMSynthesizer({
        apiKey: env.OLLAMA_API_KEY ?? "ollama",
        model: model ?? "llama3.1",
        baseUrl: env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
      });
    case "openai":
    case "": {
      if (!env.OPENAI_API_KEY) {
        if (provider === "openai") throw new Error("synthesizerFromEnv: provider=openai requires OPENAI_API_KEY");
        return null;
      }
      return new LLMSynthesizer({ apiKey: env.OPENAI_API_KEY, model, baseUrl: env.OPENAI_BASE_URL });
    }
    default:
      throw new Error(`synthesizerFromEnv: unknown VITRUS_SYNTH_PROVIDER="${provider}" (openai|anthropic|gemini|ollama|extractive)`);
  }
}
