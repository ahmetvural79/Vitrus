// src/core/hashing-embedder.ts
// Yerel, deterministik, BAĞIMLILIKSIZ embedder (dev/test için).
// Hashing trick (bag-of-words → sabit boyut) + L2 normalize. Ağ/anahtar gerektirmez.
//
// ÜRETİM DEĞİL: semantik gücü token-örtüşmesiyle sınırlı. Aynı Embedder
// arayüzünden OpenAI text-embedding-3-small veya yerel Ollama takılır (Faz 1).
// Amacı: hibrit arama hattını (vektör + BM25 + RRF) offline çalıştırmak.

import type { Embedder } from "./engine.js";

const DIM = 1536;

/** FNV-1a 32-bit — deterministik token hash. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Unicode-farkında basit tokenizasyon (Türkçe harfleri korur). */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1);
}

export class HashingEmbedder implements Embedder {
  readonly dim = DIM;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): number[] {
    const vec = new Array<number>(DIM).fill(0);
    const tokens = tokenize(text);
    for (const tok of tokens) {
      const h = fnv1a(tok);
      const idx = h % DIM;
      // İşaretli hashing (collision'ı kısmen telafi eder).
      const sign = (h & 0x80000000) !== 0 ? -1 : 1;
      vec[idx] += sign;
    }
    // L2 normalize → cosine anlamlı, sıfır-vektör tuzağı yok.
    let norm = 0;
    for (const v of vec) norm += v * v;
    norm = Math.sqrt(norm);
    if (norm === 0) return vec; // boş metin
    for (let i = 0; i < DIM; i++) vec[i] /= norm;
    return vec;
  }
}
