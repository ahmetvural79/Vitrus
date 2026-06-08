// src/skill/skill-optimize.ts
// A3 — SkillOpt (Microsoft SkillOpt paper'ın Vitrus-deterministik karşılığı).
// Bir skill'in DONMUŞ eval'ini canlı beyne karşı koşar; BAŞARISIZSA deterministik
// teşhis üretir ve beyinden TAZE bir pack kurar: güncel SKILL.md gövdesi + YENİDEN
// ÜRETİLMİŞ eval (= "it writes the benchmark for you") → self-healing skill.
//
// Glass-box: teşhis + tazeleme tamamen deterministik (buildSkillPack saf). Gövde
// yeniden-yazımı TEK opsiyonel LLM noktasıdır — enjekte edilebilir `rewriteBody`
// hook'u (BYO; mevcut OpenAIEmbedder/LLMSynthesizer deseni). Verilmezse şablon gövde.

import type { BrainEngine } from "../core/engine.js";
import type { SkillFile } from "../core/types.js";
import { buildSkillPack, type SkillPack } from "./skill-export.js";
import { runSkillEval, type SkillEvalSpec, type SkillEvalReport } from "./skill-eval.js";

export interface SkillDiagnosis {
  healthy: boolean;
  forgottenSources: string[]; // artık getirilmeyen provenance (sourceHit.missing)
  resolverBroken: boolean; // resolver kendi konusunu yönlendiremiyor
  closedGaps: string[]; // kapanan boşluk türleri (beyin öğrendi — İYİ)
  newGaps: string[]; // beliren yeni boşluk türleri
  actions: string[]; // deterministik öneri listesi
}

export interface OptimizeResult {
  name: string;
  topic: string;
  report: SkillEvalReport; // donmuş eval'in GÜNCEL beyne karşı sonucu
  diagnosis: SkillDiagnosis;
  before: SkillEvalSpec; // eski (donmuş) spec
  refreshed: SkillPack | null; // sağlıksızsa taze pack (body + yeni eval); sağlıklıysa null
}

function diagnose(report: SkillEvalReport): SkillDiagnosis {
  const forgottenSources = report.sourceHit.missing;
  const resolverBroken = !report.resolver.pass;
  const closedGaps = report.gapDrift.closed;
  const newGaps = report.gapDrift.appeared;
  const actions: string[] = [];
  if (forgottenSources.length)
    actions.push(`regenerate from current brain — ${forgottenSources.length} source(s) no longer retrieved`);
  if (resolverBroken) actions.push("regenerate triggers — resolver no longer routes to this skill");
  if (closedGaps.length) actions.push(`update known-gaps section — ${closedGaps.length} gap(s) closed (brain learned)`);
  if (newGaps.length) actions.push(`surface ${newGaps.length} new gap(s) in the skill`);
  if (!actions.length) actions.push("no changes needed");
  return { healthy: report.ok, forgottenSources, resolverBroken, closedGaps, newGaps, actions };
}

export interface OptimizeOpts {
  version?: string;
  /** Opsiyonel BYO gövde yeniden-yazıcı (LLM). Verilmezse deterministik şablon gövde. */
  rewriteBody?: (draft: string, ctx: { topic: string; skill: SkillFile }) => Promise<string>;
}

/**
 * Donmuş eval → teşhis → (gerekirse) beyinden taze pack. Sağlıklıysa refreshed=null.
 * Motorun yalnız search+think yüzeyini ister (test edilebilirlik).
 */
export async function optimizeSkill(
  engine: Pick<BrainEngine, "search" | "think">,
  spec: SkillEvalSpec,
  opts: OptimizeOpts = {}
): Promise<OptimizeResult> {
  const report = await runSkillEval(engine, spec);
  const diagnosis = diagnose(report);

  let refreshed: SkillPack | null = null;
  if (!report.ok) {
    // Beyinden TAZE pack: güncel think → body + YENİDEN ÜRETİLMİŞ eval (auto-benchmark).
    const r = await engine.think(spec.topic);
    refreshed = buildSkillPack(spec.topic, r, opts.version ?? spec.version);
    if (opts.rewriteBody) {
      const body = await opts.rewriteBody(refreshed.skill.body, { topic: spec.topic, skill: refreshed.skill });
      refreshed = { ...refreshed, skill: { ...refreshed.skill, body } };
    }
  }
  return { name: spec.name, topic: spec.topic, report, diagnosis, before: spec, refreshed };
}

export function renderOptimize(r: OptimizeResult): string {
  const out: string[] = [`🛠 SkillOpt · ${r.name} · "${r.topic}"`, ""];
  out.push(r.diagnosis.healthy ? "STATUS: ✓ healthy (eval passes)" : "STATUS: ✗ needs optimization");
  for (const a of r.diagnosis.actions) out.push(`  - ${a}`);
  if (r.refreshed) {
    const newS = r.refreshed.eval.expectSources;
    const oldS = new Set(r.before.expectSources);
    const added = newS.filter((s) => !oldS.has(s));
    const removed = r.before.expectSources.filter((s) => !newS.includes(s));
    out.push("", "REFRESHED benchmark (auto-generated from current brain):");
    out.push(
      `  sources: ${r.before.expectSources.length} → ${newS.length}` +
        (added.length ? ` (+${added.join(", ")})` : "") +
        (removed.length ? ` (−${removed.join(", ")})` : "")
    );
    out.push(`  triggers: ${r.before.resolver.triggers.join(", ")} → ${r.refreshed.eval.resolver.triggers.join(", ")}`);
  }
  return out.join("\n");
}
