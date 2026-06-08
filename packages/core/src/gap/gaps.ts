// src/gap/gaps.ts
// Gap-analysis motoru — Vitrus'ın imza farklılaştırıcısı: "beynin bilmediği".
//
// İlke: boşluk tespiti DETERMİNİSTİK ve DENETLENEBİLİR'dir. Her boşluk graf
// yapısından veya açık metin işaretinden türetilir — LLM YOK, uydurma YOK.
// (Uydurma-"biliyorum" bu üründe en ağır hata; boşluğu boşluk göstermek
//  doğru cevap kadar önemli.)
//
// Korpus-düzeyi (structuralGaps): missing / contradiction / stale / single_point / uncited.
// Sorgu-düzeyi (coverageGap): GapView deseni — en iyi eşleşme zayıfsa "kapsam yok".

import type { Gap, TypedEdge, NodeType } from "../core/types.js";

/** Boşluk analizi için gereken minimal düğüm görünümü. */
export interface GapNodeView {
  id: string;
  slug: string;
  type: NodeType;
  content: string;
  frontmatter: Record<string, unknown>;
  connector: string | null;
  sourceId: string | null;
  uri: string | null;
}

// Olay-benzeri tipler kaynak (provenance) bekler; authored referans tipleri beklemez.
const EVENT_TYPES = new Set<NodeType>(["incident", "meeting", "source"]);

// Tek-nokta / bus-factor risk işaretleri (açık metin).
const SINGLE_POINT_RE = /tek nokta|tek kişi|bus[- ]?factor|single point|yalnızca[^\n]*bilgisinde/i;

const PERSON_LINK_RE = /\[\[(?:[a-z_]+::)?([^\]]*people\/[^\]]+)\]\]/gi;

function isStub(n: GapNodeView): boolean {
  return n.frontmatter?.stub === true || n.content.trim() === "";
}

/** Bir düğümün gövdesinde geçen kişi slug'larını döndürür (related için). */
function personRefs(content: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  PERSON_LINK_RE.lastIndex = 0;
  while ((m = PERSON_LINK_RE.exec(content)) !== null) {
    out.push(m[1].trim().replace(/^\/+/, "").toLowerCase());
  }
  return out;
}

/**
 * Korpus-düzeyi yapısal boşluklar. Saf fonksiyon (DB gerektirmez) — test edilebilir.
 */
export function structuralGaps(nodes: GapNodeView[], edges: TypedEdge[]): Gap[] {
  const gaps: Gap[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // toId → ona referans veren fromId'ler (missing'in "kim referans veriyor"u).
  const referrers = new Map<string, string[]>();
  for (const e of edges) {
    if (!referrers.has(e.toId)) referrers.set(e.toId, []);
    referrers.get(e.toId)!.push(e.fromId);
  }

  // 1) MISSING — referans verilen ama belgelenmemiş (stub/boş) düğümler.
  for (const n of nodes) {
    if (!isStub(n)) continue;
    const refs = referrers.get(n.id) ?? [];
    if (refs.length === 0) continue; // referans verilmeyen stub'ı raporlama
    gaps.push({
      kind: "missing",
      message: `"${n.slug}" is referenced but undocumented (from ${refs.length} source(s)).`,
      relatedNodeIds: [n.id, ...refs],
    });
  }

  // 2a) CONTRADICTION — açık contradicts kenarları.
  for (const e of edges) {
    if (e.type !== "contradicts") continue;
    gaps.push({
      kind: "contradiction",
      message: `"${e.fromId}" contradicts "${e.toId}" — needs clarification.`,
      relatedNodeIds: [e.fromId, e.toId],
    });
  }

  // 2b) CONTRADICTION (deterministik, LLM'siz) — tek-değerli yüklem birden çok
  // güncel hedefe işaret ediyorsa (ör. aynı kişi iki ayrı şirkette works_at).
  const SINGLE_VALUED = new Set<TypedEdge["type"]>(["works_at", "reports_to"]);
  const byFromType = new Map<string, string[]>();
  for (const e of edges) {
    if (!SINGLE_VALUED.has(e.type)) continue;
    const key = `${e.fromId}|${e.type}`;
    (byFromType.get(key) ?? byFromType.set(key, []).get(key)!).push(e.toId);
  }
  for (const [key, targets] of byFromType) {
    if (targets.length < 2) continue;
    const [fromId, type] = key.split("|");
    gaps.push({
      kind: "contradiction",
      message: `"${fromId}" points to multiple current targets via single-valued "${type}": ${targets.join(", ")}.`,
      relatedNodeIds: [fromId, ...targets],
    });
  }

  // 3) STALE — supersede edilmiş (bir supersedes kenarının hedefi olan) düğümler.
  for (const e of edges) {
    if (e.type !== "supersedes") continue;
    const stale = byId.get(e.toId);
    gaps.push({
      kind: "stale",
      message: `"${e.toId}" was superseded (current: "${e.fromId}") — may be stale.`,
      relatedNodeIds: [e.toId, e.fromId].filter(() => true),
    });
    void stale;
  }

  // 4) SINGLE_POINT — gövdede açık tek-nokta/bus-factor riski belirtilen düğümler.
  for (const n of nodes) {
    const hit = n.content.match(SINGLE_POINT_RE);
    if (!hit) continue;
    const people = personRefs(n.content);
    gaps.push({
      kind: "single_point",
      message: `"${n.slug}" flags single-point/bus-factor risk: "${hit[0]}".`,
      relatedNodeIds: [n.id, ...people],
    });
  }

  // 5) UNCITED — olay/toplantı kaydı ama provenance yok (kaynaksız iddia).
  for (const n of nodes) {
    if (!EVENT_TYPES.has(n.type)) continue;
    if (n.connector || n.sourceId || n.uri) continue;
    gaps.push({
      kind: "uncited",
      message: `"${n.slug}" is a ${n.type} but has no source (connector/uri) — uncited.`,
      relatedNodeIds: [n.id],
    });
  }

  return gaps;
}

/**
 * Sorgu-düzeyi kapsam boşluğu (GapView deseni). En iyi eşleşmenin cosine
 * benzerliği taban altındaysa "beyin bu soruyu yeterince kapsamıyor" der.
 * topCosine null → hiç vektör eşleşmesi yok. floor üretimde eval ile kalibre (T14).
 */
export function coverageGap(query: string, topCosine: number | null, floor = 0.1): Gap | null {
  if (topCosine !== null && topCosine >= floor) return null;
  return {
    kind: "missing",
    message: `Not enough coverage for "${query}" in the brain (weak best match). The answer may be incomplete.`,
    relatedNodeIds: [],
  };
}

/** Boşlukları, ilgili düğümleri verilen küme ile kesişenlere indirger (think için). */
export function gapsForNodes(gaps: Gap[], nodeIds: string[]): Gap[] {
  const set = new Set(nodeIds);
  return gaps.filter((g) => g.relatedNodeIds.some((id) => set.has(id)));
}
