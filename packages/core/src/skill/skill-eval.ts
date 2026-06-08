// src/skill/skill-eval.ts
// Skill pack EVAL'i — Foxconn "skill pack has tests" disiplininin Vitrus karşılığı.
// Bir skill'in DONMUŞ beklentisini export anında provenance + gap'ten DETERMİNİSTİK
// üretir ("writes the benchmark for you") ve canlı motora karşı koşar.
//
// İki HARD kapı + bir SOFT sinyal:
//  - Kaynak temellendirme (HARD): skill'in canlı araması, türediği provenance
//    slug'larını HÂLÂ top-K'da getiriyor mu? Getirmiyorsa skill kaynaklarını
//    "unutmuş" → eval FAIL ("if it forgets, it becomes a test case failure").
//  - Resolver (HARD): routeSkills kendi konusunu bu skill'e yönlendiriyor mu?
//  - Boşluk kayması (SOFT): export anı boşlukları sürüyor mu / kapandı mı?
//    Kapanma İYİdir (beyin öğrendi) → gate DEĞİL, yalnız bilgilendirme.
//
// Glass-box: tamamı deterministik (LLM'siz) — beyni iki kez koş, aynı sonuç.

import type { BrainEngine } from "../core/engine.js";
import type { SkillFile, ThinkResult } from "../core/types.js";
import { routeSkills, type RoutableSkill } from "./route.js";

/** think() varsayılan limit'iyle (10) hizalı — eval penceresi sentez penceresini kapsar. */
const DEFAULT_TOPK = 10;

/**
 * Skill paketinin donmuş eval beklentisi. Bundle'da `eval/skill.eval.json` olarak
 * yaşar; beyin değişse de bu beklenti SABİT kalır → regresyonu yakalar.
 */
export interface SkillEvalSpec {
  name: string;
  /** Skill'in canlı çalıştırdığı sorgu (SKILL.md gövdesindeki Vitrus:search sorgusu). */
  topic: string;
  version: string;
  /** search/route penceresi. */
  topK: number;
  /** HARD: canlı arama bu provenance slug'larını hâlâ top-K'da getirmeli. */
  expectSources: string[];
  /** SOFT/drift: export anındaki boşluk türleri (kapanması İYİdir → gate değil). */
  expectGapKinds: string[];
  /** HARD: resolver kendi konusunu bu skill'e (≤expectRank sırada) yönlendirmeli. */
  resolver: { description: string; triggers: string[]; expectRank: number };
}

export interface SkillEvalReport {
  name: string;
  topic: string;
  sourceHit: { expect: string[]; got: string[]; missing: string[]; pass: boolean };
  resolver: { rank: number | null; expectRank: number; pass: boolean };
  /** Bilgilendirme — gate değil. */
  gapDrift: { expected: string[]; persisted: string[]; closed: string[]; appeared: string[] };
  /** sourceHit.pass && resolver.pass (boşluk kayması ok'a katılmaz). */
  ok: boolean;
}

function uniq(xs: string[]): string[] {
  return [...new Set(xs)];
}

/**
 * ThinkResult + skill kimliğinden donmuş eval spec'i üretir (SAF, deterministik).
 * expectSources = provenance slug'ları; expectGapKinds = export anı boşluk türleri.
 */
export function buildSkillEval(
  topic: string,
  r: ThinkResult,
  skill: Pick<SkillFile, "name" | "description" | "triggers" | "version">,
  topK = DEFAULT_TOPK
): SkillEvalSpec {
  return {
    name: skill.name,
    topic,
    version: skill.version,
    topK,
    expectSources: uniq(r.citations.map((c) => c.slug)),
    expectGapKinds: uniq(r.gaps.map((g) => g.kind)),
    resolver: { description: skill.description, triggers: skill.triggers, expectRank: 1 },
  };
}

/**
 * Donmuş spec'i CANLI motora karşı koşar. Motorun yalnız search+think yüzeyini ister
 * (test edilebilirlik). `others`: resolver eval'ini güçlendiren rakip skill'ler (opsiyonel).
 */
export async function runSkillEval(
  engine: Pick<BrainEngine, "search" | "think">,
  spec: SkillEvalSpec,
  opts: { others?: RoutableSkill[] } = {}
): Promise<SkillEvalReport> {
  // 1) HARD — kaynak temellendirme: canlı arama provenance'ı hâlâ getiriyor mu?
  const hits = await engine.search(spec.topic, { limit: spec.topK });
  const got = hits.map((h) => h.node.slug);
  const missing = spec.expectSources.filter((s) => !got.includes(s));
  const sourceHit = { expect: spec.expectSources, got, missing, pass: missing.length === 0 };

  // 2) HARD — resolver: kendi konusunu bu skill'e yönlendiriyor mu?
  const others = opts.others ?? [];
  const self: RoutableSkill = {
    name: spec.name,
    description: spec.resolver.description,
    triggers: spec.resolver.triggers,
  };
  // topK = tüm adaylar → gerçek sırayı bul (erken slice etme).
  const routed = routeSkills(spec.topic, [self, ...others], others.length + 1);
  const idx = routed.findIndex((x) => x.name === spec.name);
  const rank = idx >= 0 ? idx + 1 : null;
  const resolver = { rank, expectRank: spec.resolver.expectRank, pass: rank !== null && rank <= spec.resolver.expectRank };

  // 3) SOFT — boşluk kayması (drift): kapanma İYİ, gate DEĞİL.
  const now = await engine.think(spec.topic);
  const nowKinds = uniq(now.gaps.map((g) => g.kind));
  const persisted = spec.expectGapKinds.filter((k) => nowKinds.includes(k));
  const closed = spec.expectGapKinds.filter((k) => !nowKinds.includes(k));
  const appeared = nowKinds.filter((k) => !spec.expectGapKinds.includes(k));
  const gapDrift = { expected: spec.expectGapKinds, persisted, closed, appeared };

  return {
    name: spec.name,
    topic: spec.topic,
    sourceHit,
    resolver,
    gapDrift,
    ok: sourceHit.pass && resolver.pass,
  };
}

/** Spec'i bundle dosyasına (deterministik JSON) serileştirir. */
export function serializeSkillEval(spec: SkillEvalSpec): string {
  return JSON.stringify(spec, null, 2) + "\n";
}

/** `eval/skill.eval.json`'ı geri okur (skill-eval komutu). */
export function parseSkillEval(json: string): SkillEvalSpec {
  return JSON.parse(json) as SkillEvalSpec;
}

/** Eval raporunu insan-okunur metne çevirir (renderReport deseni). */
export function renderSkillEvalReport(r: SkillEvalReport): string {
  const out: string[] = [];
  out.push(`Vitrus skill eval · ${r.name} · "${r.topic}"`, "");

  const kept = r.sourceHit.expect.length - r.sourceHit.missing.length;
  out.push(`SOURCE GROUNDING: ${r.sourceHit.pass ? "✓" : "✗"} (${kept}/${r.sourceHit.expect.length} sources still retrieved)`);
  for (const m of r.sourceHit.missing) out.push(`  ✗ forgotten: ${m}`);

  out.push(`RESOLVER: ${r.resolver.pass ? "✓" : "✗"} (rank: ${r.resolver.rank ?? "none"} · expected ≤${r.resolver.expectRank})`);

  const d = r.gapDrift;
  out.push(`GAP DRIFT (info): expected ${d.expected.length} · persisted ${d.persisted.length} · closed ${d.closed.length} · new ${d.appeared.length}`);
  if (d.closed.length) out.push(`  ↑ closed (brain learned): ${d.closed.join(", ")}`);
  if (d.appeared.length) out.push(`  ⚠ new gap: ${d.appeared.join(", ")}`);

  out.push("", r.ok ? "✓ EVAL PASSED" : "✗ EVAL FAILED");
  return out.join("\n");
}
