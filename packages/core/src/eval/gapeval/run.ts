#!/usr/bin/env bun
// src/eval/gapeval/run.ts — Gap-Eval v0 koşucusu.
//   bun run gapeval [-- --out <path>] [--negative-control] [--determinism] [--case <substr>]
//   vitrus bench gapeval [...]  (CLI aynı main()'i süreç-içi çağırır)
//
// Her vaka için TAZE izole motor (bellek-içi PGLite + HashingEmbedder — offline,
// deterministik): beyni import et → findGaps() → gold ile skorla. Vakalar arası
// sızıntı imkânsız (bench/run.ts deseni). Çıkış kodu 1: determinizm FAIL veya
// negatif-kontrol FP > 0.

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PgliteEngine } from "../../core/pglite-engine.js";
import { HashingEmbedder } from "../../core/hashing-embedder.js";
import { MarkdownStore } from "../../store/markdown-store.js";
import type { Gap } from "../../core/types.js";
import type { CaseResult, DeterminismVerdict, GapEvalReport, GoldCase } from "./types.js";
import { matchCase, computeScore, canonicalGaps } from "./score.js";
import { renderGapEvalReport } from "./report.js";

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CORPUS = join(here, "corpus");

export interface CorpusCase {
  /** Dizin adı, ör. "case-001-missing-runbook". */
  id: string;
  /** brain/ dizininin mutlak yolu. */
  brainDir: string;
  gold: GoldCase;
}

/** Korpus dizinindeki tüm vakaları (sıralı, deterministik) yükler. */
export function loadCases(corpusDir: string = DEFAULT_CORPUS): CorpusCase[] {
  const out: CorpusCase[] = [];
  for (const name of readdirSync(corpusDir).sort()) {
    const dir = join(corpusDir, name);
    const goldPath = join(dir, "gold.json");
    if (!existsSync(goldPath)) continue; // vaka değil (gizli dosya vb.)
    const gold = JSON.parse(readFileSync(goldPath, "utf8")) as GoldCase;
    out.push({ id: name, brainDir: join(dir, "brain"), gold });
  }
  return out;
}

/** Bir beyni TAZE bellek-içi motora import edip boşlukları döndürür (izole koşum). */
export async function detectGaps(brainDir: string): Promise<{ gaps: Gap[]; nodes: number }> {
  const engine = new PgliteEngine({ embedder: new HashingEmbedder() });
  try {
    await engine.init();
    const all = new MarkdownStore(brainDir).readAll();
    // CLI import akışının aynısı (sidecar YAZMADAN — korpus dosyaları el değmeden kalır).
    for (const { node, edges } of all) await engine.putNode(node, edges);
    await engine.refreshEntities();
    await engine.refreshSalience();
    return { gaps: await engine.findGaps(), nodes: all.length };
  } finally {
    await engine.close();
  }
}

/** Tek vaka: tespit → greedy 1:1 gold eşleştirme → CaseResult. */
export async function runCase(c: CorpusCase): Promise<CaseResult> {
  const { gaps, nodes } = await detectGaps(c.brainDir);
  const { matched, falsePositives, falseNegatives } = matchCase(c.gold.expected_gaps, gaps);
  return {
    id: c.id,
    name: c.gold.name,
    clean: c.gold.expected_gaps.length === 0,
    nodes,
    expected: c.gold.expected_gaps,
    detected: gaps,
    matched,
    falsePositives,
    falseNegatives,
  };
}

/** Koşucu gövdesi — CLI (`vitrus bench gapeval`) süreç-içi çağırır; çıkış kodu döner. */
export async function main(argv: string[]): Promise<number> {
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const outPath = flag("--out");
  const caseFilter = flag("--case");
  const negativeOnly = argv.includes("--negative-control");
  const checkDeterminism = argv.includes("--determinism");
  const corpusDir = flag("--corpus") ?? DEFAULT_CORPUS;

  let cases = loadCases(corpusDir);
  if (negativeOnly) cases = cases.filter((c) => c.gold.expected_gaps.length === 0);
  if (caseFilter) cases = cases.filter((c) => c.id.includes(caseFilter));
  if (cases.length === 0) {
    console.error(`no cases matched (corpus: ${corpusDir}).`);
    return 1;
  }

  // --determinism: her vaka iki kez taze motorla koşar; kanonik (sıralı) çıktı birebir aynı olmalı.
  const results: CaseResult[] = [];
  const determinismFailures: string[] = [];
  for (const c of cases) {
    const r1 = await runCase(c);
    if (checkDeterminism) {
      const r2 = await runCase(c);
      if (canonicalGaps(r1.detected) !== canonicalGaps(r2.detected)) determinismFailures.push(c.id);
    }
    results.push(r1);
  }
  const determinism: DeterminismVerdict = checkDeterminism
    ? determinismFailures.length === 0
      ? "pass"
      : "fail"
    : "skipped";

  const score = computeScore(results, determinism);
  const report: GapEvalReport = {
    corpus: negativeOnly ? "gapeval-v0 (negative controls only)" : "gapeval-v0",
    engine: "PgliteEngine (fresh in-memory per case) · HashingEmbedder (offline deterministic) · no LLM",
    score,
    cases: results,
  };

  const md = renderGapEvalReport(report);
  console.log(md);
  if (determinismFailures.length) console.error(`determinism failures: ${determinismFailures.join(", ")}`);

  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, md, "utf8");
    const jsonPath = outPath.endsWith(".md") ? outPath.replace(/\.md$/, ".json") : outPath + ".json";
    writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf8");
    console.log(`report written: ${outPath} (+ ${jsonPath})`);
  }

  // Kapılar: determinizm FAIL veya temiz beyinde uydurma boşluk → kırmızı.
  if (determinism === "fail") return 1;
  if (score.negativeControlFalsePositives > 0) return 1;
  return 0;
}

// Doğrudan çalıştırma (bun run src/eval/gapeval/run.ts) — import edildiğinde koşmaz.
const isDirect = (() => {
  try {
    return process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();
if (isDirect) {
  process.exit(await main(process.argv.slice(2)));
}
