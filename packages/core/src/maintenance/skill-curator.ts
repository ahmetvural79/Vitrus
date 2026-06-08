// src/maintenance/skill-curator.ts
// A2 — Skill curator (Hermes self-learning loop'un Vitrus karşılığı). İKİ deterministik
// tespit (LLM'siz):
//  (a) skillify adayları: audit_log'daki TEKRARLAYAN sorgu şekilleri → "bunu skill yap".
//  (b) bayat skill'ler: provenance düğümü SİLİNMİŞ veya SÜPERSEDE edilmiş skill'ler
//      → yenile/emekli et ("curator cleans stale skills so the loop keeps compounding").
// Glass-box: tamamen deterministik, denetlenebilir — rakiplerin opak LLM curator'ının aksine.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { BrainEngine } from "../core/engine.js";
import type { AuditEntry } from "../core/types.js";
import { tokens } from "../skill/route.js";
import { parseSkillMarkdown } from "../skill/skill-file.js";

export interface SkillifyCandidate {
  query: string; // küme temsilcisi (ilk görülen sorgu)
  count: number; // küme büyüklüğü (kaç kez soruldu)
  examples: string[]; // benzersiz örnekler (≤5)
}

export interface SkillRef {
  name: string;
  provenanceSlugs: string[];
}

export interface StaleSkill {
  name: string;
  stale: { slug: string; reason: "deleted" | "superseded" }[];
}

export interface CurationReport {
  skillifyCandidates: SkillifyCandidate[];
  staleSkills: StaleSkill[];
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * audit_log'daki sorguları token-örtüşmesiyle (route.ts tokenizasyonu) kümeler;
 * ≥minRepeats tekrarlayan şekilleri "skillify adayı" döndürür. Greedy + sıralı →
 * deterministik (aynı audit → aynı kümeler).
 */
export function skillifyCandidates(
  audit: AuditEntry[],
  opts: { minRepeats?: number; threshold?: number } = {}
): SkillifyCandidate[] {
  const minRepeats = opts.minRepeats ?? 3;
  const threshold = opts.threshold ?? 0.6;
  const clusters: { rep: string; repTokens: Set<string>; queries: string[] }[] = [];
  for (const a of audit) {
    const t = tokens(a.query);
    if (t.size === 0) continue;
    const hit = clusters.find((c) => jaccard(t, c.repTokens) >= threshold);
    if (hit) hit.queries.push(a.query);
    else clusters.push({ rep: a.query, repTokens: t, queries: [a.query] });
  }
  return clusters
    .filter((c) => c.queries.length >= minRepeats)
    .map((c) => ({ query: c.rep, count: c.queries.length, examples: [...new Set(c.queries)].slice(0, 5) }))
    .sort((a, b) => b.count - a.count || a.query.localeCompare(b.query));
}

/**
 * provenance düğümü SİLİNMİŞ (getNode null) veya SÜPERSEDE edilmiş skill'leri bayat
 * işaretler. Süpersede = bir supersedes kenarının HEDEFİ; gaps.ts stale gap'ini
 * `relatedNodeIds[0]` (= e.toId, süpersede edilen) ile okur — süpersede EDEN yeni
 * düğümü yanlışlıkla bayat saymaz. Deterministik.
 */
export async function findStaleSkills(
  engine: Pick<BrainEngine, "getNode" | "findGaps">,
  skills: SkillRef[]
): Promise<StaleSkill[]> {
  const gaps = await engine.findGaps();
  const supersededKeys = new Set(
    gaps.filter((g) => g.kind === "stale").map((g) => g.relatedNodeIds[0]).filter(Boolean)
  );
  const out: StaleSkill[] = [];
  for (const s of skills) {
    const stale: StaleSkill["stale"] = [];
    for (const slug of s.provenanceSlugs) {
      const node = await engine.getNode(slug);
      if (!node) stale.push({ slug, reason: "deleted" });
      else if (supersededKeys.has(node.id) || supersededKeys.has(slug)) stale.push({ slug, reason: "superseded" });
    }
    if (stale.length) out.push({ name: s.name, stale });
  }
  return out;
}

/** Yayınlanmış skill bundle'larını diskten okur: <dir>/<name>/SKILL.md → provenance slug'ları. */
export function loadSkillRefs(dir: string): SkillRef[] {
  if (!existsSync(dir)) return [];
  const refs: SkillRef[] = [];
  for (const name of readdirSync(dir).sort()) {
    const skillMd = join(dir, name, "SKILL.md");
    if (!existsSync(skillMd)) continue;
    const skill = parseSkillMarkdown(readFileSync(skillMd, "utf8"));
    refs.push({ name: skill.name || name, provenanceSlugs: skill.provenance.map((p) => p.slug) });
  }
  return refs;
}

export function renderCuration(r: CurationReport): string {
  const out: string[] = ["🧹 Skill curation"];
  out.push(`  skillify candidates (repeated queries): ${r.skillifyCandidates.length}`);
  for (const c of r.skillifyCandidates) out.push(`    - "${c.query}" (×${c.count})`);
  out.push(`  stale skills (source deleted/superseded): ${r.staleSkills.length}`);
  for (const s of r.staleSkills)
    out.push(`    - ${s.name}: ${s.stale.map((x) => `${x.slug} (${x.reason})`).join(", ")}`);
  return out.join("\n");
}
