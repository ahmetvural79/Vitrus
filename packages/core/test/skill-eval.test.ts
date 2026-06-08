import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import { MarkdownStore } from "../src/store/markdown-store.js";
import { buildSkillPack, skillPackToBundle } from "../src/skill/skill-export.js";
import {
  buildSkillEval,
  runSkillEval,
  serializeSkillEval,
  parseSkillEval,
} from "../src/skill/skill-eval.js";
import type { BrainEngine } from "../src/core/engine.js";
import type { ThinkResult } from "../src/core/types.js";

const brainDir = join(dirname(fileURLToPath(import.meta.url)), "..", "brain");

async function buildEngine(): Promise<PgliteEngine> {
  const engine = new PgliteEngine({ embedder: new HashingEmbedder() });
  await engine.init();
  for (const { node, edges } of new MarkdownStore(brainDir).readAll()) await engine.putNode(node, edges);
  return engine;
}

function syntheticResult(): ThinkResult {
  return {
    answer: "...",
    citations: [
      { nodeId: "durable/policies/incident-response", slug: "durable/policies/incident-response", uri: null },
      { nodeId: "durable/incidents/2026-05-12", slug: "durable/incidents/2026-05-12", uri: "http://s/i" },
    ],
    gaps: [{ kind: "single_point", message: "escalation tek kişide", relatedNodeIds: ["x"] }],
    oldestSourceDays: 21,
    confidence: 0.5,
    mode: "business",
  };
}

const skillId = {
  name: "incident-nasil-cozulur",
  description: "Incident'ların nasıl çözüleceğini şirket beyninden çıkarır; on-call sırasında kullanılır.",
  triggers: ["incident", "nasil"],
  version: "0.1.0",
};

// --- birim (saf, deterministik) ---

test("buildSkillEval: provenance → expectSources, gap kind → expectGapKinds", () => {
  const spec = buildSkillEval("incident nasıl çözülür", syntheticResult(), skillId);
  assert.deepEqual(spec.expectSources, [
    "durable/policies/incident-response",
    "durable/incidents/2026-05-12",
  ]);
  assert.deepEqual(spec.expectGapKinds, ["single_point"]);
  assert.equal(spec.topic, "incident nasıl çözülür");
  assert.equal(spec.resolver.expectRank, 1);
  assert.ok(spec.resolver.triggers.includes("incident"));
});

test("buildSkillEval: tekrarlı provenance slug'ı tekilleşir", () => {
  const r = syntheticResult();
  r.citations.push({ nodeId: "dup", slug: "durable/policies/incident-response", uri: null });
  const spec = buildSkillEval("incident", r, skillId);
  assert.equal(spec.expectSources.length, 2); // tekrar elendi
});

test("serializeSkillEval/parseSkillEval round-trip eder", () => {
  const spec = buildSkillEval("incident", syntheticResult(), skillId);
  assert.deepEqual(parseSkillEval(serializeSkillEval(spec)), spec);
});

test("skillPackToBundle: eval/skill.eval.json bundle'a eklenir (skill pack'in testi var)", () => {
  const pack = buildSkillPack("incident nasıl çözülür", syntheticResult());
  const paths = skillPackToBundle(pack).files.map((f) => f.path);
  assert.ok(paths.includes(`${pack.skill.name}/SKILL.md`));
  assert.ok(paths.includes(`${pack.skill.name}/reference/kaynaklar.md`));
  assert.ok(paths.includes(`${pack.skill.name}/eval/skill.eval.json`));
});

test("runSkillEval: resolver kendi konusunu bulamazsa FAIL (stub motor)", async () => {
  const stub: Pick<BrainEngine, "search" | "think"> = {
    async search() {
      return [];
    },
    async think() {
      return { answer: "", citations: [], gaps: [], oldestSourceDays: 0, confidence: 0, mode: "business" };
    },
  };
  const spec = {
    name: "alakasiz-skill",
    topic: "incident nasıl çözülür",
    version: "0.1.0",
    topK: 10,
    expectSources: [], // boş → kaynak kapısı trivially geçer
    expectGapKinds: [],
    resolver: { description: "tamamen alakasiz", triggers: ["zzz"], expectRank: 1 },
  };
  const report = await runSkillEval(stub, spec);
  assert.equal(report.sourceHit.pass, true);
  assert.equal(report.resolver.pass, false); // "incident..." → "alakasiz-skill" eşleşmez
  assert.equal(report.ok, false);
});

// --- entegrasyon (canlı örnek beyin) ---

test("runSkillEval: örnek beyinden üretilen skill kendi eval'ini GEÇER", async () => {
  const engine = await buildEngine();
  try {
    const topic = "incident müdahale politikası runbook"; // bilinen retrieval vakası
    const pack = buildSkillPack(topic, await engine.think(topic));
    assert.ok(pack.eval.expectSources.length > 0, "skill kaynaklara dayanmalı");
    const report = await runSkillEval(engine, pack.eval);
    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.equal(report.sourceHit.pass, true);
    assert.equal(report.resolver.pass, true);
  } finally {
    await engine.close();
  }
});

test("runSkillEval: beyin bir kaynağı unutursa eval FAIL eder (regresyon yakalama)", async () => {
  const engine = await buildEngine();
  try {
    const topic = "incident müdahale politikası runbook";
    const pack = buildSkillPack(topic, await engine.think(topic));
    // Donmuş beklentiye beyinde OLMAYAN bir kaynak ekle → "unutma" simülasyonu.
    const tampered = {
      ...pack.eval,
      expectSources: [...pack.eval.expectSources, "durable/yok/olmayan-kaynak"],
    };
    const report = await runSkillEval(engine, tampered);
    assert.equal(report.sourceHit.pass, false);
    assert.equal(report.ok, false);
    assert.ok(report.sourceHit.missing.includes("durable/yok/olmayan-kaynak"));
  } finally {
    await engine.close();
  }
});
