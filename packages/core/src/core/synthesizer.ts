// src/core/synthesizer.ts
// Sentezleyici: hit'lerden cevap üretir. Embedder gibi DEĞİŞTİRİLEBİLİR —
// varsayılan deterministik/çıkarımsal (offline, LLM'siz); üretimde LLM
// sentezleyici aynı arayüzden takılır.
//
// İlke: "hiçbir iddia kaynaksız sunulmaz." Çıkarımsal sentezleyici bunu
// YAPISAL olarak garanti eder — her cümle bir kaynak hit'inden gelir ve [n]
// işaretiyle ona bağlanır. Uydurma yok.

import type { SearchHit } from "./types.js";

export interface Synthesis {
  answer: string; // [n] işaretleriyle
  citations: { nodeId: string; slug: string; uri: string | null }[]; // [n] ↔ [n-1]
}

export interface SynthesizeOpts {
  /** Hedef cevap dili ("tr"|"en"|...); üretim LLM sentezleyici cevabı bu dilde üretir. */
  lang?: string;
}

export interface Synthesizer {
  // async: LLM sentezleyici ağ çağrısı yapar; ExtractiveSynthesizer trivial-async.
  synthesize(query: string, hits: SearchHit[], opts?: SynthesizeOpts): Promise<Synthesis>;
}

const STOP = new Set([
  "ve", "ile", "bir", "bu", "için", "nasıl", "ne", "the", "a", "an", "is", "of", "to",
]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

/** [[type::slug]] / [[slug]] → okunur ad (son segment). */
function stripWikilinks(s: string): string {
  return s.replace(/\[\[(?:[a-z_]+::)?([^\]]+)\]\]/gi, (_m, slug: string) => {
    const seg = String(slug).split("/").pop() ?? String(slug);
    return seg.replace(/-/g, " ");
  });
}

/** Bir düğümün gövdesinden sorguya en ilgili tek cümleyi çıkarır. */
function bestSentence(content: string, qTokens: Set<string>): string {
  const clean = stripWikilinks(content);
  const sentences = clean
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/^#+\s*/, "").replace(/^[-*>]\s*/, "").trim())
    .filter((s) => s.length > 12);
  if (sentences.length === 0) return clean.trim().slice(0, 160);

  let best = sentences[0];
  let bestScore = -1;
  for (const s of sentences) {
    const st = tokens(s);
    let overlap = 0;
    for (const t of st) if (qTokens.has(t)) overlap++;
    if (overlap > bestScore) {
      bestScore = overlap;
      best = s;
    }
  }
  return best.length > 200 ? best.slice(0, 197) + "…" : best;
}

export class ExtractiveSynthesizer implements Synthesizer {
  constructor(private readonly maxFacts = 5) {}

  async synthesize(query: string, hits: SearchHit[], opts: SynthesizeOpts = {}): Promise<Synthesis> {
    const en = opts.lang === "en";
    // Stub/boş düğümleri sentezde kullanma (içerik yok).
    const usable = hits.filter((h) => h.node.content.trim().length > 0).slice(0, this.maxFacts);
    if (usable.length === 0) {
      const msg = en
        ? `No sourced content found in the brain for "${query}".`
        : `"${query}" için beyinde kaynaklı içerik bulunamadı.`;
      return { answer: msg, citations: [] };
    }

    const qTokens = new Set(tokens(query));
    // Çıkarımsal sentez kaynak cümleyi olduğu gibi alır (kaynak dilinde); yalnız çerçeve
    // metni sorgu dilini izler. Gerçek "sorgu dilinde cevap" = LLMSynthesizer.
    const header = en ? `Sourced findings from the brain for "${query}":` : `"${query}" için beynin kaynaklı bulguları:`;
    const lines: string[] = [header, ""];
    const citations = usable.map((h, i) => {
      const fact = bestSentence(h.node.content, qTokens);
      lines.push(`- ${fact} [${i + 1}]`);
      return { nodeId: h.node.id, slug: h.node.slug, uri: h.node.provenance.uri };
    });

    return { answer: lines.join("\n"), citations };
  }
}
