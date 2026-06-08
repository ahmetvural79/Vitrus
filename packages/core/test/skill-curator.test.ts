import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import { MarkdownStore } from "../src/store/markdown-store.js";
import { skillifyCandidates, findStaleSkills } from "../src/maintenance/skill-curator.js";
import type { AuditEntry } from "../src/core/types.js";

function audit(query: string): AuditEntry {
  return { at: "", principal: "u", query, returned: [], excluded: [] };
}

// --- skillify adayları (saf, deterministik) ---

test("skillifyCandidates: tekrarlayan sorgu şekli aday olur; tekil olmaz", () => {
  const a = [
    audit("incident nasıl çözülür"),
    audit("incident nasıl çözülür hızlıca"), // ortak: incident, nasıl, çözülür
    audit("peki incident nasıl çözülür"), // ortak: incident, nasıl, çözülür
    audit("rate limit eşiği kaç rps"), // alakasız → ayrı, tekil
  ];
  const c = skillifyCandidates(a, { minRepeats: 3, threshold: 0.5 });
  assert.equal(c.length, 1);
  assert.equal(c[0].count, 3);
  assert.match(c[0].query, /incident/);
});

test("skillifyCandidates: minRepeats altındaki tekrar aday değil", () => {
  const c = skillifyCandidates([audit("alfa beta gama"), audit("alfa beta gama")], { minRepeats: 3 });
  assert.equal(c.length, 0);
});

// --- bayat skill tespiti (motor) ---

const brainDir = join(dirname(fileURLToPath(import.meta.url)), "..", "brain");
async function buildEngine(): Promise<PgliteEngine> {
  const e = new PgliteEngine({ embedder: new HashingEmbedder() });
  await e.init();
  for (const { node, edges } of new MarkdownStore(brainDir).readAll()) await e.putNode(node, edges);
  return e;
}

test("findStaleSkills: süpersede edilmiş ve silinmiş provenance bayat; güncel değil", async () => {
  const e = await buildEngine();
  try {
    const stale = await findStaleSkills(e, [
      { name: "rate-limit-skill", provenanceSlugs: ["durable/decisions/0003-rate-limit"] }, // süpersede
      { name: "ghost-skill", provenanceSlugs: ["durable/yok/olmayan-kaynak"] }, // silinmiş
      { name: "fresh-skill", provenanceSlugs: ["durable/decisions/0007-rate-limit"] }, // güncel (süpersede EDEN)
    ]);
    const byName = Object.fromEntries(stale.map((s) => [s.name, s]));
    assert.equal(byName["rate-limit-skill"]?.stale[0].reason, "superseded");
    assert.equal(byName["ghost-skill"]?.stale[0].reason, "deleted");
    assert.ok(!byName["fresh-skill"], "süpersede EDEN güncel skill bayat olmamalı");
  } finally {
    await e.close();
  }
});
