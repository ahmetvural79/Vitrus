// src/ops/ops.ts
// Ops-haritası / VERİMSİZLİK dedektörleri — gap-analysis'in operasyonel kuzeni. Cerenovus'un
// "şirketi sistem olarak haritala → verimsizlik çıkar" wedge'ine DETERMİNİSTİK cevap: bulgular
// graf yapısından (tipli kenarlar) türetilir — LLM YOK, uydurma YOK (gaps.ts ile aynı duruş).
//
// Dedektörler (hepsi kenar-yapısı):
//   unowned        — sahipsiz servis (owns geleni 0) → sorumluluk boşluğu
//   bus_factor     — tek KİŞİye bağlı servis (person owner == 1) → tek-nokta riski
//   bottleneck     — yüksek in-degree kişi/ekip (reports_to+owns+depends_on hedefi) → aşırı yük
//   broken_handoff — bayat (süpersede) bir şeye depends_on → eskimiş zemine bağımlılık
//   redundant_tool — embedding-benzer iki servis (çakışan/atıl araç) → konsolidasyon fırsatı
//                    (tek embedding-tabanlı dedektör; benzer çiftleri engine dedupReview ile sağlar)

import type { TypedEdge, NodeType } from "../core/types.js";

export interface OpsNodeView {
  id: string;
  slug: string;
  type: NodeType;
}

export interface OpsFinding {
  kind: "unowned" | "bus_factor" | "bottleneck" | "broken_handoff" | "redundant_tool";
  severity: "low" | "medium" | "high";
  message: string;
  relatedNodeIds: string[];
}

/** Embedding-benzer düğüm çifti (engine dedupReview'den; slug + cosine benzerlik). */
export interface SimilarPair {
  a: string; // slug
  b: string; // slug
  sim: number;
}

const SEV_RANK: Record<OpsFinding["severity"], number> = { high: 3, medium: 2, low: 1 };

const HUB_EDGES = new Set<TypedEdge["type"]>(["reports_to", "owns", "depends_on"]);

/** Korpus-düzeyi operasyonel verimsizlikler. Saf fonksiyon (DB gerektirmez) — test edilebilir. */
export function operationalFindings(
  nodes: OpsNodeView[],
  edges: TypedEdge[],
  opts: { bottleneckThreshold?: number; similarPairs?: SimilarPair[] } = {}
): OpsFinding[] {
  const findings: OpsFinding[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const bySlug = new Map(nodes.map((n) => [n.slug, n]));
  const slug = (id: string) => byId.get(id)?.slug ?? id;

  // supersede edilen (bayat) düğümler — broken_handoff için.
  const staleSet = new Set(edges.filter((e) => e.type === "supersedes").map((e) => e.toId));

  // owns: hedef id → sahip id'leri.
  const ownersOf = new Map<string, string[]>();
  for (const e of edges) {
    if (e.type !== "owns") continue;
    (ownersOf.get(e.toId) ?? ownersOf.set(e.toId, []).get(e.toId)!).push(e.fromId);
  }

  // in-degree (hub kenarları) → bottleneck.
  const inDeg = new Map<string, number>();
  for (const e of edges) {
    if (!HUB_EDGES.has(e.type)) continue;
    inDeg.set(e.toId, (inDeg.get(e.toId) ?? 0) + 1);
  }

  // 1) UNOWNED — sahibi olmayan servis (sorumluluk boşluğu).
  for (const n of nodes) {
    if (n.type !== "service") continue;
    if ((ownersOf.get(n.id) ?? []).length === 0) {
      findings.push({
        kind: "unowned",
        severity: "high",
        message: `"${n.slug}" is a service with no owner — nobody is accountable.`,
        relatedNodeIds: [n.id],
      });
    }
  }

  // 2) BUS_FACTOR — yalnız tek KİŞİnin sahip olduğu servis.
  for (const n of nodes) {
    if (n.type !== "service") continue;
    const personOwners = (ownersOf.get(n.id) ?? []).filter((o) => byId.get(o)?.type === "person");
    if (personOwners.length === 1) {
      findings.push({
        kind: "bus_factor",
        severity: "medium",
        message: `"${n.slug}" depends on a single person ("${slug(personOwners[0])}") — bus-factor risk.`,
        relatedNodeIds: [n.id, personOwners[0]],
      });
    }
  }

  // 3) BOTTLENECK — çok şeyin bağlı olduğu kişi/ekip (aşırı yüklenmiş hub).
  const threshold = opts.bottleneckThreshold ?? 4;
  for (const [id, deg] of inDeg) {
    const n = byId.get(id);
    if (!n || (n.type !== "person" && n.type !== "team")) continue;
    if (deg >= threshold) {
      findings.push({
        kind: "bottleneck",
        severity: deg >= threshold * 2 ? "high" : "medium",
        message: `"${n.slug}" is a bottleneck — ${deg} things depend on / report to it.`,
        relatedNodeIds: [id],
      });
    }
  }

  // 4) BROKEN_HANDOFF — bayat (süpersede) bir şeye depends_on (eskimiş zemine bağımlılık).
  for (const e of edges) {
    if (e.type !== "depends_on" || !staleSet.has(e.toId)) continue;
    findings.push({
      kind: "broken_handoff",
      severity: "high",
      message: `"${slug(e.fromId)}" depends on superseded "${slug(e.toId)}" — handoff on outdated ground.`,
      relatedNodeIds: [e.fromId, e.toId],
    });
  }

  // 5) REDUNDANT_TOOL — embedding-benzer İKİ SERVİS (çakışan/atıl araç → konsolidasyon).
  // Benzer çiftler engine'den (dedupReview, pgvector); burada yalnız tip filtresi + mesaj (pure).
  const seenPair = new Set<string>();
  for (const p of opts.similarPairs ?? []) {
    const a = bySlug.get(p.a);
    const b = bySlug.get(p.b);
    if (!a || !b || a.type !== "service" || b.type !== "service") continue;
    const key = [a.id, b.id].sort().join("|");
    if (seenPair.has(key)) continue;
    seenPair.add(key);
    findings.push({
      kind: "redundant_tool",
      severity: "medium",
      message: `"${a.slug}" and "${b.slug}" overlap (similarity ${p.sim.toFixed(2)}) — likely redundant tools; consolidate?`,
      relatedNodeIds: [a.id, b.id],
    });
  }

  // Şiddete göre sırala (yüksek önce), sonra kind (deterministik çıktı).
  return findings.sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || a.kind.localeCompare(b.kind));
}

/** Bulguları sorgu düğümleriyle kesişenlere indirger (think/surface için). */
export function opsForNodes(findings: OpsFinding[], nodeIds: string[]): OpsFinding[] {
  const set = new Set(nodeIds);
  return findings.filter((f) => f.relatedNodeIds.some((id) => set.has(id)));
}

export function renderOps(findings: OpsFinding[]): string {
  if (findings.length === 0) return "✓ no operational inefficiencies detected.";
  return findings.map((f) => `[${f.severity}] ${f.kind}: ${f.message}`).join("\n");
}
