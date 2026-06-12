// src/eval/gapeval/types.ts
// Gap-Eval v0 — altın-etiketli korpusa karşı boşluk-tespit kalitesinin şemaları.
// Korpus: her vaka = küçük markdown beyin + gold.json (beklenen boşluklar).
// Skor: tip bazında precision/recall/F1 + negatif kontrol FP + determinizm bayrağı.

import type { Gap } from "../../core/types.js";

export type GapKind = Gap["kind"];

/** Tip-bazlı tablo sırası sabittir (rapor deterministik kalsın). */
export const GAP_KINDS: readonly GapKind[] = [
  "missing",
  "contradiction",
  "stale",
  "single_point",
  "uncited",
] as const;

/** gold.json'daki tek bir beklenen boşluk. `match`: gap'in relatedNodeIds'inde
 *  ya da message'ında geçmesi beklenen alt-dize (eşleştirme anahtarı). */
export interface GoldGapSpec {
  kind: GapKind;
  match: string;
}

/** gold.json dosya şeması. expected_gaps boş → temiz (negatif kontrol) vakası. */
export interface GoldCase {
  name: string;
  expected_gaps: GoldGapSpec[];
}

/** Bir gold girdisinin tükettiği tespit (greedy 1:1 eşleşme). */
export interface MatchedPair {
  gold: GoldGapSpec;
  gap: Gap;
}

/** Tek vakanın koşum sonucu (taze izole motor → import → findGaps → skor). */
export interface CaseResult {
  /** Dizin adı, ör. "case-001-missing-runbook". */
  id: string;
  /** gold.json'daki insan-okunur ad. */
  name: string;
  /** Negatif kontrol mü (expected_gaps boş)? */
  clean: boolean;
  /** Beyindeki .md düğüm sayısı. */
  nodes: number;
  expected: GoldGapSpec[];
  detected: Gap[];
  matched: MatchedPair[];
  /** Eşleşmeyen tespitler = yanlış pozitif. */
  falsePositives: Gap[];
  /** Eşleşmeyen gold girdileri = yanlış negatif (sessiz kaçırma). */
  falseNegatives: GoldGapSpec[];
}

/** Tek bir boşluk tipinin toplulaştırılmış metrikleri. */
export interface KindScore {
  kind: GapKind;
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
}

export type DeterminismVerdict = "pass" | "fail" | "skipped";

/** Korpus genel skoru — raporun omurgası. */
export interface GapEvalScore {
  perKind: KindScore[];
  overall: { tp: number; fp: number; fn: number; precision: number; recall: number; f1: number };
  /** Tüm vakalardaki toplam yanlış pozitif. */
  falsePositives: number;
  /** Temiz (negatif kontrol) vaka sayısı. */
  negativeControlCases: number;
  /** Temiz vakalarda raporlanan boşluk sayısı — hedef 0. */
  negativeControlFalsePositives: number;
  /** --determinism koşulmadıysa "skipped". */
  determinism: DeterminismVerdict;
}

/** Rapor artefaktı (markdown + JSON aynı veriden üretilir). */
export interface GapEvalReport {
  corpus: string;
  engine: string;
  score: GapEvalScore;
  cases: CaseResult[];
}
