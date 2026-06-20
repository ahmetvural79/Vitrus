// src/core/providers/common.ts
// Sağlayıcı (provider) ortak yardımcıları. Embedder/Synthesizer sağlayıcıları (OpenAI,
// Gemini, Cohere, Anthropic, Ollama) buradan beslenir. Yeni bağımlılık yok: düz fetch
// (OpenAIEmbedder deseni), enjekte edilebilir → offline deterministik test.

import type { SearchHit } from "../types.js";
import type { Synthesis } from "../synthesizer.js";

/**
 * L2 normalize. Matryoshka/truncated boyutta dönen embedding'ler (Gemini
 * outputDimensionality<3072, bazı Cohere tipleri) normalize edilmeden gelir;
 * cosine'in anlamlı olması için normalize ederiz. Sıfır-vektör korunur.
 */
export function l2normalize(v: number[]): number[] {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}

/**
 * Embedding'i donmuş şema boyutuna (varsayılan 1536) uyarla: uzunsa baştan kes
 * (Matryoshka-güvenli — Voyage/ZeroEntropy en önemli boyutları başa koyar), kısaysa
 * sıfırla doldur. Çağıran sonra l2normalize eder → cosine anlamlı kalır.
 */
export function fitDim(v: number[], target: number): number[] {
  if (v.length === target) return v;
  if (v.length > target) return v.slice(0, target);
  return [...v, ...new Array(target - v.length).fill(0)];
}

/** Sentez için kullanılabilir hit'ler (boş içerik elenir, maxFacts ile kırpılır). */
export function selectUsable(hits: SearchHit[], maxFacts: number): SearchHit[] {
  return hits.filter((h) => h.node.content.trim().length > 0).slice(0, maxFacts);
}

/** "Kaynak yok" mesajı (sorgu dilini izler). */
export function notFound(query: string, lang?: string): string {
  return lang === "en"
    ? `No sourced content found in the brain for "${query}".`
    : `"${query}" için beyinde kaynaklı içerik bulunamadı.`;
}

/**
 * Grounding garantisi: citations [n] → usable[n-1] SABİT eşlenir (model uyduramaz).
 * Tüm LLM sağlayıcıları aynı çerçeveyi kullanır → glass-box korunur.
 */
export function citationsOf(usable: SearchHit[]): Synthesis["citations"] {
  return usable.map((h) => ({ nodeId: h.node.id, slug: h.node.slug, uri: h.node.provenance.uri }));
}

/** Tüm sağlayıcılarda ortak sistem+kullanıcı istemi (LLMSynthesizer ile aynı sözleşme). */
export function buildPrompt(query: string, usable: SearchHit[], lang: string): { system: string; user: string } {
  const sources = usable.map((h, i) => `[${i + 1}] ${h.node.slug}\n${h.node.content.slice(0, 800)}`).join("\n\n");
  const system =
    `You are Vitrus's answer synthesizer. Answer ONLY from the numbered sources below. ` +
    `Cite every claim with its [n] marker. Never invent facts not in the sources. ` +
    `Write the answer in the language with code "${lang}" (the user's query language); if "und", match the query's language.`;
  const user = `Query: ${query}\n\nSources:\n${sources}`;
  return { system, user };
}
