import { test } from "node:test";
import assert from "node:assert/strict";
import { matchGap, matchCase, computeScore, canonicalGaps } from "../src/eval/gapeval/score.js";
import { loadCases, runCase, detectGaps } from "../src/eval/gapeval/run.js";
import type { Gap } from "../src/core/types.js";
import type { CaseResult } from "../src/eval/gapeval/types.js";

const gap = (kind: Gap["kind"], message: string, related: string[] = []): Gap => ({
  kind,
  message,
  relatedNodeIds: related,
});

test("matchGap: kind eşit + match alt-dizesi (id VEYA message) gerekir", () => {
  const g = gap("missing", '"durable/people/priya" is referenced but undocumented.', [
    "durable/people/priya",
    "durable/documents/onboarding-checklist",
  ]);
  assert.ok(matchGap({ kind: "missing", match: "priya" }, g)); // id'de
  assert.ok(matchGap({ kind: "missing", match: "referenced but undocumented" }, g)); // message'da
  assert.ok(!matchGap({ kind: "stale", match: "priya" }, g)); // kind farklı → eşleşmez
  assert.ok(!matchGap({ kind: "missing", match: "zzz-yok" }, g)); // alt-dize yok
});

test("matchCase: greedy 1:1 — bir tespit iki gold'u birden karşılayamaz", () => {
  const detected = [gap("stale", 'old superseded', ["durable/decisions/0008"])];
  const expected = [
    { kind: "stale" as const, match: "0008" },
    { kind: "stale" as const, match: "0008" }, // aynı tespiti ister ama tüketilmiş → FN
  ];
  const r = matchCase(expected, detected);
  assert.equal(r.matched.length, 1);
  assert.equal(r.falseNegatives.length, 1);
  assert.equal(r.falsePositives.length, 0);
});

test("matchCase: eşleşmeyen tespit = FP, eşleşmeyen gold = FN", () => {
  const detected = [
    gap("missing", "x missing", ["a"]),
    gap("uncited", "y uncited", ["b"]), // beklenmiyor → FP
  ];
  const expected = [
    { kind: "missing" as const, match: "a" },
    { kind: "contradiction" as const, match: "c" }, // tespit yok → FN
  ];
  const r = matchCase(expected, detected);
  assert.equal(r.matched.length, 1);
  assert.equal(r.falsePositives.length, 1);
  assert.equal(r.falsePositives[0].kind, "uncited");
  assert.equal(r.falseNegatives.length, 1);
  assert.equal(r.falseNegatives[0].kind, "contradiction");
});

test("computeScore: tip-bazında P/R/F1 + negatif kontrol FP sayımı", () => {
  const mk = (over: Partial<CaseResult>): CaseResult => ({
    id: "c",
    name: "c",
    clean: false,
    nodes: 1,
    expected: [],
    detected: [],
    matched: [],
    falsePositives: [],
    falseNegatives: [],
    ...over,
  });
  const g = gap("missing", "m", ["a"]);
  const cases: CaseResult[] = [
    mk({ id: "hit", matched: [{ gold: { kind: "missing", match: "a" }, gap: g }] }),
    mk({ id: "miss", falseNegatives: [{ kind: "missing", match: "b" }] }),
    mk({ id: "clean-fp", clean: true, falsePositives: [gap("uncited", "spurious", ["x"])] }),
  ];
  const s = computeScore(cases, "skipped");
  const missing = s.perKind.find((k) => k.kind === "missing")!;
  assert.equal(missing.tp, 1);
  assert.equal(missing.fn, 1);
  assert.equal(missing.precision, 1); // FP'si yok
  assert.equal(missing.recall, 0.5);
  assert.equal(s.overall.fp, 1); // temiz vakadaki uncited
  assert.equal(s.negativeControlCases, 1);
  assert.equal(s.negativeControlFalsePositives, 1);
  assert.equal(s.determinism, "skipped");
});

test("korpus: 18 vaka yüklenir — 5 tipin her biri ≥3 vaka + 3 temiz negatif kontrol", () => {
  const cases = loadCases();
  assert.equal(cases.length, 18);
  const clean = cases.filter((c) => c.gold.expected_gaps.length === 0);
  assert.equal(clean.length, 3);
  const byKind = new Map<string, number>();
  for (const c of cases)
    for (const g of c.gold.expected_gaps) byKind.set(g.kind, (byKind.get(g.kind) ?? 0) + 1);
  for (const kind of ["missing", "contradiction", "stale", "single_point", "uncited"])
    assert.ok((byKind.get(kind) ?? 0) >= 3, `kind ${kind} < 3 vaka`);
});

test("uçtan uca: case-001 taze motorda import → findGaps → tam skor (recall 1, FP 0)", async () => {
  const c = loadCases().find((x) => x.id === "case-001-missing-runbook")!;
  const r = await runCase(c);
  assert.equal(r.clean, false);
  assert.ok(r.nodes >= 3);
  assert.equal(r.falseNegatives.length, 0, "beklenen missing yakalanmalı");
  assert.equal(r.falsePositives.length, 0, "uydurma boşluk olmamalı");
  assert.equal(r.matched.length, 1);
  assert.equal(r.matched[0].gap.kind, "missing");
});

test("negatif kontrol: temiz vakanın gold'u boş VE motor 0 boşluk üretir", async () => {
  const c = loadCases().find((x) => x.id === "case-016-clean-payments-team")!;
  assert.equal(c.gold.expected_gaps.length, 0); // gold gerçekten temiz
  const r = await runCase(c);
  assert.equal(r.detected.length, 0, `temiz beyinde boşluk üretildi: ${JSON.stringify(r.detected)}`);
  assert.equal(r.falsePositives.length, 0);
});

test("determinizm: aynı vaka iki taze koşuda birebir aynı (sıralı) boşluk çıktısı", async () => {
  const c = loadCases().find((x) => x.id === "case-015-mixed-incident-aftermath")!;
  const a = await detectGaps(c.brainDir);
  const b = await detectGaps(c.brainDir);
  assert.equal(canonicalGaps(a.gaps), canonicalGaps(b.gaps));
  assert.ok(a.gaps.length >= 3); // karışık vaka: stale + missing + uncited
});
