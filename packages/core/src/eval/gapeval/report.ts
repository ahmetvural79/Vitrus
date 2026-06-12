// src/eval/gapeval/report.ts
// Gap-Eval skor kartı: markdown (insan) + JSON (CI artefaktı) aynı rapor nesnesinden.
// Çıktı dili İngilizce (UI katmanı); dürüst metodoloji notu rapora gömülü.

import type { GapEvalReport, KindScore } from "./types.js";

const pct = (n: number): string => `${Math.round(n * 1000) / 10}%`;

function kindRow(k: KindScore): string {
  return `| ${k.kind} | ${k.tp} | ${k.fp} | ${k.fn} | ${pct(k.precision)} | ${pct(k.recall)} | ${pct(k.f1)} |`;
}

export function renderGapEvalReport(r: GapEvalReport): string {
  const s = r.score;
  const out: string[] = [];

  out.push(`# Vitrus Gap-Eval v0 — scorecard`);
  out.push("");
  out.push(`Corpus: **${r.corpus}** · ${r.cases.length} cases (${s.negativeControlCases} clean negative controls) · engine: ${r.engine}`);
  out.push("");

  // --- tip bazında tablo ---
  out.push(`## Per-kind results`);
  out.push("");
  out.push(`| kind | TP | FP | FN | precision | recall | F1 |`);
  out.push(`|------|----|----|----|-----------|--------|----|`);
  for (const k of s.perKind) out.push(kindRow(k));
  out.push(`| **overall** | ${s.overall.tp} | ${s.overall.fp} | ${s.overall.fn} | **${pct(s.overall.precision)}** | **${pct(s.overall.recall)}** | **${pct(s.overall.f1)}** |`);
  out.push("");

  // --- negatif kontrol ---
  out.push(`## Negative control`);
  out.push("");
  out.push(
    s.negativeControlCases === 0
      ? `_No clean cases in this run._`
      : `False positives on ${s.negativeControlCases} clean brain(s): **${s.negativeControlFalsePositives}** ${s.negativeControlFalsePositives === 0 ? "✓ (target 0)" : "✗ (target 0)"}`
  );
  out.push("");

  // --- determinizm ---
  out.push(`## Determinism`);
  out.push("");
  out.push(
    s.determinism === "skipped"
      ? `SKIPPED (run with \`--determinism\` to verify: each case twice, identical sorted gap output expected).`
      : s.determinism === "pass"
        ? `**PASS** — every case ran twice on fresh isolated engines and produced byte-identical sorted gap output (no LLM, no randomness).`
        : `**FAIL** — at least one case produced different gap output across two runs.`
  );
  out.push("");

  // --- vaka tablosu ---
  out.push(`## Cases`);
  out.push("");
  out.push(`| case | nodes | expected | detected | matched | FP | FN |`);
  out.push(`|------|-------|----------|----------|---------|----|----|`);
  for (const c of r.cases) {
    out.push(
      `| ${c.id} | ${c.nodes} | ${c.expected.length} | ${c.detected.length} | ${c.matched.length} | ${c.falsePositives.length} | ${c.falseNegatives.length} |`
    );
  }
  out.push("");

  // --- kaçırılanlar / uydurmalar (varsa, ayıklama için) ---
  const misses = r.cases.flatMap((c) => c.falseNegatives.map((g) => `- ${c.id}: expected ${g.kind} matching "${g.match}" — not detected`));
  const spurious = r.cases.flatMap((c) => c.falsePositives.map((g) => `- ${c.id}: unexpected ${g.kind} — ${g.message}`));
  if (misses.length || spurious.length) {
    out.push(`## Mismatches`);
    out.push("");
    out.push(...misses, ...spurious);
    out.push("");
  }

  // --- dürüst metodoloji notu ---
  out.push(`## Methodology (honest notes)`);
  out.push("");
  out.push(`- **Synthetic v0 corpus.** Small, hand-authored gold-labeled brains (3–8 markdown nodes each) designed by the Vitrus team to exercise the five gap kinds through the engine's real mechanisms (dangling wikilinks, \`contradicts\`/\`supersedes\` edges, single-valued predicate conflicts, provenance-less events, explicit bus-factor flags). Scores measure the detector against its own documented gap definitions on controlled inputs — they do **not** claim real-world generalization.`);
  out.push(`- **Deterministic engine, no LLM.** Gap detection is pure graph/text-structure analysis (\`gap/gaps.ts\`); this run uses a fresh in-memory PGLite engine per case with the offline deterministic HashingEmbedder. No model call influences any score.`);
  out.push(`- **Scoring.** Greedy 1:1 matching: a detected gap matches a gold entry iff same kind AND the gold \`match\` substring appears in a related node id or the message. Unmatched detections count as false positives, unmatched gold entries as false negatives. Per-kind and overall precision/recall/F1 are aggregated over all cases in the run.`);
  out.push(`- **Negative controls.** Clean brains with \`expected_gaps: []\` measure the false-positive rate; the target is 0 (a fabricated gap is the "boy who cried wolf" failure mode).`);
  out.push("");

  return out.join("\n");
}
