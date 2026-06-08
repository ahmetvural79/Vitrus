// src/search/hybrid.ts
// RRF birleştirme yardımcısı (SQL fonksiyonunun TS aynası).
// Motor SQL'i kullanır; bu, test ve açıklama için referans implementasyon.

import type { Tier } from "../core/types.js";

export interface RankedList {
  ids: string[]; // sıralı (en iyi önce)
}

/**
 * Reciprocal Rank Fusion. k=60 sabit (paper değeri, korpuslar arası sağlam).
 * Birden çok sıralı listeyi (vektör + BM25 + entity) tek skora birleştirir.
 */
export function rrf(lists: RankedList[], k = 60): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.ids.forEach((id, i) => {
      const rank = i + 1;
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank));
    });
  }
  return scores;
}

/** Kaynak-katman güçlendirme: durable > derived > working. */
export function tierBoost(tier: Tier): number {
  return { durable: 1.15, derived: 1.05, working: 1.0 }[tier];
}

/** Birleşik sıralama: RRF + tier boost. */
export function fuse(
  lists: RankedList[],
  tierOf: (id: string) => Tier,
  k = 60
): { id: string; score: number }[] {
  const base = rrf(lists, k);
  return [...base.entries()]
    .map(([id, s]) => ({ id, score: s * tierBoost(tierOf(id)) }))
    .sort((a, b) => b.score - a.score);
}
