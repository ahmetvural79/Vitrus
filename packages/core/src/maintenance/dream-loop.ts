// src/maintenance/dream-loop.ts
// Rüya döngüsü (Letta sleep-time deseni) — ama DETERMİNİSTİK + DENETLENEBİLİR.
// Rakipler (Letta/Cognee) bunu ajan/LLM ile opak yapar; biz inşa ettiğimiz
// bakım primitiflerini saf, tekrarlanabilir, raporlanabilir bir geçişte birleştiririz.
//
// Adımlar (hepsi LLM'siz): varlık + salience yeniden hesap → dedup ≥0.92 OTOMATİK
// birleştir → bayat (süpersede) düğüm salience sönümü → boşluk raporu.
// LLM yalnız "derived katman özeti" için OPSİYONEL olurdu (burada yapılmaz).
// Gece cron: `vitrus dream` zamanlanır.

import type { BrainEngine } from "../core/engine.js";
import {
  skillifyCandidates,
  findStaleSkills,
  type SkillifyCandidate,
  type StaleSkill,
  type SkillRef,
} from "./skill-curator.js";

export interface DreamReport {
  entities: number;
  merges: { survivor: string; duplicate: string; sim: number }[];
  staleDecayed: number;
  expired: number; // B2: TTL süpürmesiyle soft-delete edilen (süresi geçmiş) düğüm
  gaps: number;
  gapKinds: Record<string, number>;
  skillifyCandidates: SkillifyCandidate[]; // A2: tekrarlayan sorgu → skill adayı
  staleSkills: StaleSkill[]; // A2: provenance silinmiş/süpersede → bayat skill
}

export async function dreamLoop(
  engine: BrainEngine,
  opts: { dedupThreshold?: number; skills?: SkillRef[] } = {}
): Promise<DreamReport> {
  const threshold = opts.dedupThreshold ?? 0.92;

  // 0) B2 TTL süpürmesi: süresi geçmiş (ör. eski oturum) düğümleri soft-delete et.
  const expired = await engine.expireStale();

  // 1) Graftan varlık + frekans×tazelik salience yeniden hesabı.
  await engine.refreshEntities();
  await engine.refreshSalience();

  // 2) Dedup ≥ threshold → OTOMATİK birleştir (survivor = lexikografik küçük slug).
  const dups = await engine.dedupReview(threshold);
  const merges: DreamReport["merges"] = [];
  const touched = new Set<string>();
  for (const { a, b, sim } of dups) {
    const [survivor, duplicate] = a < b ? [a, b] : [b, a];
    if (touched.has(survivor) || touched.has(duplicate)) continue; // zincirleme birleştirme yok
    await engine.mergeNodes(survivor, duplicate);
    touched.add(duplicate);
    touched.add(survivor);
    merges.push({ survivor, duplicate, sim: Math.round(sim * 1000) / 1000 });
  }

  // 3) Bayat (süpersede edilmiş) düğümlerin salience sönümü.
  const staleDecayed = await engine.decayStale();

  // Birleştirme grafı değiştirdiyse varlık/salience tazele.
  if (merges.length) {
    await engine.refreshEntities();
    await engine.refreshSalience();
  }

  // 4) Boşluk raporu (beynin hâlâ bilmediği).
  const gaps = await engine.findGaps();
  const gapKinds: Record<string, number> = {};
  for (const g of gaps) gapKinds[g.kind] = (gapKinds[g.kind] ?? 0) + 1;

  const entities = (await engine.listEntities(1)).length;

  // 5) Skill curation (A2) — tekrarlayan sorgu → skillify adayı; bayat provenance → bayat skill.
  const audit = await engine.getAudit();
  const skillify = skillifyCandidates(audit);
  const staleSkills = await findStaleSkills(engine, opts.skills ?? []);

  return { entities, merges, staleDecayed, expired, gaps: gaps.length, gapKinds, skillifyCandidates: skillify, staleSkills };
}

export function renderDream(r: DreamReport): string {
  const out: string[] = [];
  out.push("🌙 Dream loop (deterministic consolidation)");
  out.push(`  entities: ${r.entities} · merges: ${r.merges.length} · expired: ${r.expired} · stale-decay: ${r.staleDecayed} · gaps: ${r.gaps}`);
  for (const m of r.merges) out.push(`  ↺ merged: ${m.duplicate} → ${m.survivor} (sim ${m.sim})`);
  const kinds = Object.entries(r.gapKinds).map(([k, n]) => `${k}:${n}`).join(" · ");
  if (kinds) out.push(`  gap kinds: ${kinds}`);
  if (r.skillifyCandidates.length) out.push(`  skillify candidates: ${r.skillifyCandidates.length}`);
  if (r.staleSkills.length) out.push(`  stale skills: ${r.staleSkills.length}`);
  return out.join("\n");
}
