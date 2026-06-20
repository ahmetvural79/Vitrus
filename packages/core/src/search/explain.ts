// src/search/explain.ts
// Sıralama atıfı ("--explain"): bir SearchHit'in skor faktörlerini insan-okunur döker.
// Veri zaten SearchHit üstünde (vectorRank/bm25Rank/entityRank + boosts.{tier,cosine,rerank,...});
// bu modül yalnız FORMATLAR — yeni hesap yapmaz, determinizmi bozmaz.
// Graf-sinyali ranking (M3.1) boosts'a yeni anahtar eklediğinde burası OTOMATİK yüzeyler
// (boosts üzerinden generic döngü → bilinmeyen anahtar olduğu gibi yazılır, ileri-uyumlu).

import type { SearchHit } from "../core/types.js";

// boosts anahtarı → okunur etiket. Bilinmeyen anahtar olduğu gibi gösterilir.
const BOOST_LABEL: Record<string, string> = {
  tier: "tier",
  cosine: "cosine",
  rerank: "rerank",
  adjacency: "graph-adjacency",
  corroboration: "cross-source",
  backlink: "backlinks",
  salience: "salience",
  recency: "recency",
};
// Çarpan olarak uygulanan boost'lar (× ile); diğerleri ham skor (= ile) gösterilir.
const MULTIPLIER_BOOSTS = new Set(["tier", "adjacency", "corroboration", "backlink", "recency"]);

/**
 * Bir hit'in skor faktörlerini sıralı, hizalı satırlar olarak döndürür:
 * önce ham sinyal sıraları (vector/bm25/entity), sonra boost'lar, en sonda birleşik skor.
 */
export function explainFactors(hit: SearchHit): string[] {
  const lines: string[] = [];
  // Etiketi sabit genişliğe hizala; 15+ karakterlik etiketlerde de en az bir ayraç boşluk kalsın.
  const k = (s: string) => (s.length >= 15 ? s + " " : s.padEnd(15));
  if (hit.vectorRank !== undefined) lines.push(`${k("vector")}rank #${hit.vectorRank}`);
  if (hit.bm25Rank !== undefined) lines.push(`${k("bm25")}rank #${hit.bm25Rank}`);
  if (hit.entityRank !== undefined) lines.push(`${k("entity")}rank #${hit.entityRank}`);
  for (const [key, val] of Object.entries(hit.boosts ?? {})) {
    const label = BOOST_LABEL[key] ?? key;
    lines.push(`${k(label)}${MULTIPLIER_BOOSTS.has(key) ? `×${val}` : `= ${val}`}`);
  }
  lines.push(`${k("→ score")}${hit.score.toFixed(5)}`);
  return lines;
}

/** Çok-satırlı, girintili açıklama bloğu — CLI `--explain` altında her sonucun altına basılır. */
export function formatExplain(hit: SearchHit, indent = "        "): string {
  return explainFactors(hit).map((l) => indent + l).join("\n");
}
