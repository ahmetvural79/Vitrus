// src/conflicts/conflicts.ts
// Çelişki ÇÖZÜM görünümü — "kaynaklar çeliştiğinde Vitrus söyler" (Glen'in itirafı: çelişki
// çözmüyoruz). contradiction gap'lerini İKİ TARAFIYLA (slug+başlık) eşler + çözüm durumu verir:
// taraflar arasında `supersedes` kenarı varsa ÇÖZÜLDÜ (kazanan eskiyi geçersiz kıldı). Saf fonksiyon.

import type { Gap, TypedEdge } from "../core/types.js";

export interface ConflictSide {
  id: string;
  slug: string;
  title: string;
}

export interface Conflict {
  a: ConflictSide;
  b: ConflictSide;
  kind: "explicit" | "single_valued";
  /** a,b arasında supersedes kenarı var mı → çelişki çözüldü (biri diğerini geçersiz kıldı). */
  resolved: boolean;
  message: string;
}

/** contradiction gap'leri + supersedes kenarları + düğüm bilgisi → çift-taraflı Conflict listesi. */
export function buildConflicts(
  contradictions: Gap[],
  supersedes: TypedEdge[],
  nodeById: Map<string, { slug: string; title: string }>
): Conflict[] {
  const supPairs = new Set<string>();
  for (const e of supersedes) {
    supPairs.add(`${e.fromId}|${e.toId}`);
    supPairs.add(`${e.toId}|${e.fromId}`);
  }
  const side = (id: string): ConflictSide => ({ id, slug: nodeById.get(id)?.slug ?? id, title: nodeById.get(id)?.title ?? id });

  const out: Conflict[] = [];
  for (const g of contradictions) {
    if (g.kind !== "contradiction") continue;
    const ids = g.relatedNodeIds;
    if (ids.length < 2) continue;
    const aId = ids[0];
    const singleValued = g.message.includes("single-valued");
    for (const bId of ids.slice(1)) {
      out.push({
        a: side(aId),
        b: side(bId),
        kind: singleValued ? "single_valued" : "explicit",
        resolved: supPairs.has(`${aId}|${bId}`),
        message: g.message,
      });
    }
  }
  // Açık (resolved=false) çelişkiler önce.
  return out.sort((x, y) => Number(x.resolved) - Number(y.resolved));
}

export function renderConflicts(conflicts: Conflict[]): string {
  if (conflicts.length === 0) return "✓ no conflicts — your sources agree.";
  return conflicts
    .map((c) => `${c.resolved ? "✓ resolved" : "⚠ OPEN    "} "${c.a.slug}" ⇄ "${c.b.slug}" (${c.kind})`)
    .join("\n");
}
