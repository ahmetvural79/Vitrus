// src/search/graph-signals.ts
// Graf-sinyali yeniden-skorlama (M3.1) — deterministik, LLM'siz.
// hybrid_search (RRF + tier) sonrası aday havuzunu graf bağlantılarıyla zenginleştirir:
//  • adjacency   — havuz-içi BAŞKA sonuçlara bağlı düğüm yükselir (faktörsel ilgi: "diğer cevaplarla bağlı").
//  • cross-source corroboration — FARKLI connector'lardan düğümlerle bağlı düğüm yükselir (çok-kaynak teyidi).
// YALNIZ havuz-içi (ACL-geçmiş) düğümler arası kenarlar kullanılır → sızıntı yok.
// score yeni = score × adjBoost × corrBoost; boosts.adjacency / boosts.corroboration kaydedilir
// (--explain bunları otomatik yüzeyler). Nihai sıralama çağıran motora bırakılır (deterministik sort orada).

import type { SearchHit } from "../core/types.js";

/** Havuz-içi canlı kenar (node id → node id). Yön önemsiz (komşuluk undirected sayılır). */
export interface GraphSignalEdge {
  from: string;
  to: string;
}

export interface GraphSignalOpts {
  adjPer?: number; // komşu başına çarpan artışı (varsayılan 0.04)
  adjCap?: number; // en çok sayılacak komşu (varsayılan 3) → adjacency en fazla ×1.12
  corrPer?: number; // farklı-kaynak başına çarpan artışı (varsayılan 0.06)
  corrCap?: number; // en çok sayılacak farklı kaynak (varsayılan 2) → corroboration en fazla ×1.12
}

/**
 * Aday havuzunu graf sinyalleriyle yeniden skorlar. Saf fonksiyon (deterministik, yan etkisiz).
 * Sıralamayı DEĞİŞTİRMEZ — yalnız score + boosts günceller; motor sonra deterministik sort eder.
 */
export function applyGraphSignals(
  hits: SearchHit[],
  edges: GraphSignalEdge[],
  opts: GraphSignalOpts = {}
): SearchHit[] {
  const adjPer = opts.adjPer ?? 0.04;
  const adjCap = opts.adjCap ?? 3;
  const corrPer = opts.corrPer ?? 0.06;
  const corrCap = opts.corrCap ?? 2;
  if (hits.length < 2 || edges.length === 0) return hits;

  const inPool = new Set(hits.map((h) => h.node.id));
  const neighbors = new Map<string, Set<string>>();
  const addN = (a: string, b: string) => {
    let s = neighbors.get(a);
    if (!s) {
      s = new Set();
      neighbors.set(a, s);
    }
    s.add(b);
  };
  for (const e of edges) {
    if (e.from === e.to || !inPool.has(e.from) || !inPool.has(e.to)) continue;
    addN(e.from, e.to);
    addN(e.to, e.from);
  }
  if (neighbors.size === 0) return hits;

  const connectorOf = new Map(hits.map((h) => [h.node.id, h.node.provenance.connector ?? ""]));

  return hits.map((h) => {
    const nb = neighbors.get(h.node.id);
    if (!nb || nb.size === 0) return h;
    const adjBoost = 1 + adjPer * Math.min(nb.size, adjCap);
    // cross-source: komşuların connector'ları, bu düğümünkinden FARKLI olan distinct sayısı.
    const mine = connectorOf.get(h.node.id) ?? "";
    const others = new Set<string>();
    for (const id of nb) {
      const c = connectorOf.get(id) ?? "";
      if (c && c !== mine) others.add(c);
    }
    const corrBoost = 1 + corrPer * Math.min(others.size, corrCap);
    const boosts: Record<string, number> = { ...(h.boosts ?? {}) };
    if (adjBoost !== 1) boosts.adjacency = Number(adjBoost.toFixed(4));
    if (corrBoost !== 1) boosts.corroboration = Number(corrBoost.toFixed(4));
    return { ...h, score: h.score * adjBoost * corrBoost, boosts };
  });
}
