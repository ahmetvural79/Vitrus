// src/sync/chunk.ts
// Markdown/kod-farkında chunking. Uzun belgeleri yapı sınırlarında (başlık,
// paragraf, kod bloğu) parçalara böler. LLM yok — saf yapı.
//
// Kullanım: node embedding'i chunk'ların ortalamasından üretilir (uzun belge
// için tek-vektör bag yerine daha iyi temsil) + chunk'lar denetlenebilir saklanır.

export interface Chunk {
  idx: number;
  content: string;
}

/** Metni bloklara ayırır: kod fence'leri bütün kalır; başlık/paragraf sınırları. */
function splitBlocks(text: string): string[] {
  const blocks: string[] = [];
  let buf: string[] = [];
  let inFence = false;

  const flush = () => {
    if (buf.length) {
      const s = buf.join("\n").trim();
      if (s) blocks.push(s);
      buf = [];
    }
  };

  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) {
      if (!inFence) {
        flush();
        inFence = true;
        buf.push(line);
      } else {
        buf.push(line);
        blocks.push(buf.join("\n")); // fence bloğu bütün
        buf = [];
        inFence = false;
      }
      continue;
    }
    if (inFence) {
      buf.push(line);
      continue;
    }
    if (line.trim() === "") {
      flush(); // boş satır → paragraf sınırı
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      flush(); // başlık yeni blok başlatır
      buf.push(line);
      continue;
    }
    buf.push(line);
  }
  flush();
  return blocks;
}

/**
 * Metni en fazla maxChars'lık chunk'lara böler. Bloklar açgözlü paketlenir;
 * tek başına büyük blok (dev kod/paragraf) sert bölünür. text <= maxChars → tek chunk.
 */
export function chunkText(text: string, opts: { maxChars?: number } = {}): Chunk[] {
  const maxChars = opts.maxChars ?? 1200;
  const trimmed = text.trim();
  if (trimmed.length === 0) return [{ idx: 0, content: "" }];
  if (trimmed.length <= maxChars) return [{ idx: 0, content: trimmed }];

  const out: string[] = [];
  let cur = "";
  const flushCur = () => {
    if (cur) {
      out.push(cur);
      cur = "";
    }
  };
  for (const b of splitBlocks(trimmed)) {
    const isFence = /^\s*```/.test(b);
    if (b.length > maxChars) {
      flushCur();
      if (isFence) {
        out.push(b); // KOD-FARKINDA: kod bloğu sınırı aşsa da bölünmez
      } else {
        for (let i = 0; i < b.length; i += maxChars) out.push(b.slice(i, i + maxChars));
      }
      continue;
    }
    if (cur && cur.length + 2 + b.length > maxChars) {
      flushCur();
      cur = b;
    } else {
      cur = cur ? cur + "\n\n" + b : b;
    }
  }
  flushCur();
  return out.map((content, idx) => ({ idx, content }));
}

/** Chunk embedding'lerini L2-normalize ortalamayla birleştirir (mean-pool). */
export function meanPool(vectors: number[][]): number[] {
  const dim = vectors[0]?.length ?? 0;
  const sum = new Array<number>(dim).fill(0);
  for (const v of vectors) for (let i = 0; i < dim; i++) sum[i] += v[i];
  const n = vectors.length || 1;
  for (let i = 0; i < dim; i++) sum[i] /= n;
  let norm = 0;
  for (const x of sum) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < dim; i++) sum[i] /= norm;
  return sum;
}
