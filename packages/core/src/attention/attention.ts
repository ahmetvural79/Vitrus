// src/attention/attention.ts
// Proaktif "dikkatini bekleyenler" (v1) — gap-analizinin ZAMANSAL uzantısı. Reaktif "ne sordun" yerine
// "neyin dikkatini beklediği"ni yüzeye çıkarır (deneme: assists→finishes). DETERMİNİSTİK, LLM YOK:
// her öğe düğüm tipi/tier'ı, zaman damgası ve mevcut yapısal boşluklardan türetilir. `now` DIŞARIDAN
// verilir (core'da Date.now YOK → test edilebilir; çağıran CLI/API gerçek saati geçer).

import type { Gap, TypedEdge, NodeType, Tier } from "../core/types.js";

/** Attention için gereken minimal düğüm görünümü (zaman damgalı). */
export interface AttentionNodeView {
  id: string;
  slug: string;
  type: NodeType;
  tier: Tier;
  title: string;
  updatedAt: string; // ISO
  capturedAt: string | null; // ISO (kaynakta oluşma)
}

export type AttentionKind = "stale_knowledge" | "unresolved_incident" | "aging_gap";
export type Severity = "high" | "medium" | "low";

export interface AttentionItem {
  kind: AttentionKind;
  slug: string;
  title: string;
  message: string;
  ageDays: number;
  severity: Severity;
}

export interface AttentionOpts {
  staleDays?: number; // kalıcı bilgi bayatlama eşiği (default 90)
  incidentDays?: number; // çözülmemiş incident yaş eşiği (default 7)
  gapAgeDays?: number; // açık boşluğun "yaşlanmış" sayılma eşiği (default 14)
  limit?: number; // azami öğe (default 20)
}

const DAY = 86_400_000;
// Bayatlama izlenecek "kaynak bilgi" tipleri (kişi/takım/şirket "rot" etmez → hariç).
const KNOWLEDGE_TYPES = new Set<NodeType>(["decision", "policy", "document", "service"]);
const SEV_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/** İki ISO arasındaki tam gün farkı (negatifse 0). Deterministik (verilen string'ler). */
function daysBetween(fromISO: string, nowISO: string): number {
  const a = Date.parse(fromISO);
  const b = Date.parse(nowISO);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.floor((b - a) / DAY));
}

/**
 * Proaktif dikkat öğeleri (deterministik). nodes + edges + gaps + `now` → severity ve yaşa göre sıralı liste.
 *   stale_knowledge : kalıcı (durable) karar/politika/doküman/servis N gündür güncellenmemiş.
 *   unresolved_incident : incident, `resolved_by` kenarı YOK ve N günden eski.
 *   aging_gap : yapısal boşluk + ilgili en eski düğüm M günden eski (bilinen-bilinmeyen yaşlanıyor).
 */
export function computeAttention(
  nodes: AttentionNodeView[],
  edges: TypedEdge[],
  gaps: Gap[],
  now: string,
  opts: AttentionOpts = {}
): AttentionItem[] {
  const staleDays = opts.staleDays ?? 90;
  const incidentDays = opts.incidentDays ?? 7;
  const gapAgeDays = opts.gapAgeDays ?? 14;
  const limit = opts.limit ?? 20;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const resolved = new Set<string>();
  for (const e of edges) {
    if (e.type === "resolved_by") {
      resolved.add(e.fromId);
      resolved.add(e.toId);
    }
  }

  const items: AttentionItem[] = [];

  // 1) stale_knowledge
  for (const n of nodes) {
    if (n.tier !== "durable" || !KNOWLEDGE_TYPES.has(n.type)) continue;
    const age = daysBetween(n.updatedAt, now);
    if (age <= staleDays) continue;
    items.push({
      kind: "stale_knowledge",
      slug: n.slug,
      title: n.title,
      message: `"${n.title}" hasn't been updated in ${age} days — this durable ${n.type} may be stale.`,
      ageDays: age,
      severity: age > staleDays * 2 ? "high" : "medium",
    });
  }

  // 2) unresolved_incident
  for (const n of nodes) {
    if (n.type !== "incident" || resolved.has(n.id)) continue;
    const age = daysBetween(n.capturedAt ?? n.updatedAt, now);
    if (age <= incidentDays) continue;
    items.push({
      kind: "unresolved_incident",
      slug: n.slug,
      title: n.title,
      message: `"${n.title}" has been open for ${age} days (no resolution edge).`,
      ageDays: age,
      severity: age > incidentDays * 3 ? "high" : "medium",
    });
  }

  // 3) aging_gap — yapısal boşluk + ilgili en eski düğüm M günden yaşlı.
  for (const g of gaps) {
    let oldest = -1;
    let node: AttentionNodeView | undefined;
    for (const id of g.relatedNodeIds) {
      const n = byId.get(id);
      if (!n) continue;
      const age = daysBetween(n.updatedAt, now);
      if (age > oldest) {
        oldest = age;
        node = n;
      }
    }
    if (!node || oldest <= gapAgeDays) continue;
    items.push({
      kind: "aging_gap",
      slug: node.slug,
      title: node.title,
      message: `${g.message} (open for ${oldest} days)`,
      ageDays: oldest,
      severity: g.kind === "contradiction" || oldest > gapAgeDays * 3 ? "high" : "medium",
    });
  }

  // Sıralama: severity → yaş (azalan) → slug (kararlı/deterministik).
  items.sort(
    (a, b) =>
      SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.ageDays - a.ageDays || a.slug.localeCompare(b.slug)
  );
  return items.slice(0, limit);
}
