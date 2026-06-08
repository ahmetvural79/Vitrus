import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import { MarkdownStore } from "../src/store/markdown-store.js";
import { buildSkillPack } from "../src/skill/skill-export.js";
import { runSkillEval } from "../src/skill/skill-eval.js";
import { optimizeSkill } from "../src/skill/skill-optimize.js";

const brainDir = join(dirname(fileURLToPath(import.meta.url)), "..", "brain");
const TOPIC = "incident müdahale politikası runbook";

async function buildEngine(): Promise<PgliteEngine> {
  const e = new PgliteEngine({ embedder: new HashingEmbedder() });
  await e.init();
  for (const { node, edges } of new MarkdownStore(brainDir).readAll()) await e.putNode(node, edges);
  return e;
}

test("optimizeSkill: sağlıklı skill → değişiklik yok, refreshed null", async () => {
  const e = await buildEngine();
  try {
    const pack = buildSkillPack(TOPIC, await e.think(TOPIC));
    const r = await optimizeSkill(e, pack.eval);
    assert.equal(r.diagnosis.healthy, true);
    assert.equal(r.refreshed, null);
    assert.deepEqual(r.diagnosis.actions, ["no changes needed"]);
  } finally {
    await e.close();
  }
});

test("optimizeSkill: unutulmuş kaynak → teşhis + beyinden taze pack (self-heal)", async () => {
  const e = await buildEngine();
  try {
    const pack = buildSkillPack(TOPIC, await e.think(TOPIC));
    // Donmuş eval'e beyinde OLMAYAN bir kaynak ekle → eval FAIL.
    const broken = { ...pack.eval, expectSources: [...pack.eval.expectSources, "durable/yok/olmayan-kaynak"] };
    const r = await optimizeSkill(e, broken);

    assert.equal(r.diagnosis.healthy, false);
    assert.ok(r.diagnosis.forgottenSources.includes("durable/yok/olmayan-kaynak"));
    assert.ok(r.refreshed, "sağlıksız skill için taze pack üretilmeli");
    // YENİDEN ÜRETİLMİŞ benchmark uydurma kaynağı içermez (beyinden türetildi)...
    assert.ok(!r.refreshed!.eval.expectSources.includes("durable/yok/olmayan-kaynak"));
    // ...ve taze pack kendi eval'ini GEÇER (self-healed).
    assert.equal((await runSkillEval(e, r.refreshed!.eval)).ok, true);
  } finally {
    await e.close();
  }
});

test("optimizeSkill: opsiyonel rewriteBody hook (BYO LLM) gövdeyi yeniden yazar", async () => {
  const e = await buildEngine();
  try {
    const pack = buildSkillPack(TOPIC, await e.think(TOPIC));
    const broken = { ...pack.eval, expectSources: [...pack.eval.expectSources, "durable/yok/olmayan"] };
    const r = await optimizeSkill(e, broken, {
      rewriteBody: async (_draft, ctx) => `# Rewritten for ${ctx.topic}\n`,
    });
    assert.ok(r.refreshed!.skill.body.startsWith("# Rewritten for"));
  } finally {
    await e.close();
  }
});
