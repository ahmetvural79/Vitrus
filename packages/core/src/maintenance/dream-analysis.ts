// src/maintenance/dream-analysis.ts
// M3.8 — Rüya döngüsü DERİNLEŞTİRME: deterministik analiz fazları (LLM YOK, tekrarlanabilir, denetlenebilir).
//   · suggestCitations    — uncited düğüm → korpustan kaynaklı (uri'li) benzer düğüm öner (citation-fix)
//   · contradictionDigest — açık çelişkiler + hangi taraf daha yeni (deterministik çözüm ipucu)
//   · buildBriefing       — scheduled-prep "sabah brifingi": dikkat + boşluk + çelişki + öneri özeti
import type { BrainEngine } from "../core/engine.js";

// ── citation-fix ────────────────────────────────────────────────────────────
export interface CitationSuggestion {
  slug: string;
  title: string;
  /** Korpustaki en iyi kaynaklı (uri'li) eşleşme — yoksa null (gerçekten yeni bilgi). */
  suggestion: { slug: string; title: string; uri: string | null; score: number } | null;
}

/** Kaynaksız (uncited) düğümler için korpustan kaynaklı destek öner. Deterministik (hibrit arama). */
export async function suggestCitations(engine: BrainEngine, opts: { limit?: number } = {}): Promise<CitationSuggestion[]> {
  const cap = opts.limit ?? 20;
  const uncited = (await engine.findGaps()).filter((g) => g.kind === "uncited");
  const ids = [...new Set(uncited.flatMap((g) => g.relatedNodeIds))].slice(0, cap);
  const meta = await engine.nodesMeta(ids);
  const out: CitationSuggestion[] = [];
  for (const m of meta) {
    const hits = await engine.search(m.title || m.slug, { limit: 5 });
    const sourced = hits.find((h) => h.node.slug !== m.slug && !!h.node.provenance.uri);
    out.push({
      slug: m.slug,
      title: m.title,
      suggestion: sourced
        ? { slug: sourced.node.slug, title: sourced.node.title, uri: sourced.node.provenance.uri, score: Math.round(sourced.score * 1000) / 1000 }
        : null,
    });
  }
  return out;
}

// ── contradiction-trend (digest) ─────────────────────────────────────────────
export interface ContradictionItem {
  a: string;
  b: string;
  kind: string;
  /** Daha yeni güncellenen taraf (büyük olasılıkla güncel olan) — çözüm ipucu; eşit/bilinmiyorsa null. */
  newer: string | null;
  message: string;
}

/** Açık (çözülmemiş) açık-çelişkiler + hangi tarafın daha yeni olduğu (deterministik çözüm ipucu). */
export async function contradictionDigest(engine: BrainEngine): Promise<ContradictionItem[]> {
  const open = (await engine.findConflicts()).filter((c) => !c.resolved && c.kind === "explicit");
  const out: ContradictionItem[] = [];
  for (const c of open) {
    const [na, nb] = await Promise.all([engine.getNode(c.a.slug), engine.getNode(c.b.slug)]);
    const newer = na && nb ? (na.updatedAt >= nb.updatedAt ? c.a.slug : c.b.slug) : null;
    out.push({ a: c.a.slug, b: c.b.slug, kind: c.kind, newer, message: c.message });
  }
  return out;
}

// ── scheduled-prep briefing ───────────────────────────────────────────────────
export interface Briefing {
  generatedAt: string;
  attention: { kind: string; slug: string; message: string; severity: string }[];
  gapCounts: Record<string, number>;
  openConflicts: number;
  fixableUncited: number; // citation önerisi BULUNAN uncited düğüm sayısı
}

/** "Sabah brifingi": dikkat + boşluk + çelişki + düzeltilebilir-uncited özeti (deterministik digest). */
export async function buildBriefing(engine: BrainEngine, now: string, opts: { attentionLimit?: number } = {}): Promise<Briefing> {
  const att = await engine.attention(now);
  const gaps = await engine.findGaps();
  const gapCounts: Record<string, number> = {};
  for (const g of gaps) gapCounts[g.kind] = (gapCounts[g.kind] ?? 0) + 1;
  const conflicts = await engine.findConflicts();
  const cites = await suggestCitations(engine, { limit: 20 });
  return {
    generatedAt: now,
    attention: att.slice(0, opts.attentionLimit ?? 8).map((a) => ({ kind: a.kind, slug: a.slug, message: a.message, severity: a.severity })),
    gapCounts,
    openConflicts: conflicts.filter((c) => !c.resolved).length,
    fixableUncited: cites.filter((c) => c.suggestion).length,
  };
}

export function renderBriefing(b: Briefing): string {
  const out = [`☀️ Briefing · ${b.generatedAt}`];
  const gk = Object.entries(b.gapCounts).map(([k, n]) => `${k}:${n}`).join(" · ");
  out.push(`  gaps: ${gk || "none"} · open conflicts: ${b.openConflicts} · uncited with a suggested source: ${b.fixableUncited}`);
  if (b.attention.length) {
    out.push("  needs attention:");
    for (const a of b.attention) out.push(`   [${a.severity}] ${a.message}`);
  }
  return out.join("\n");
}
