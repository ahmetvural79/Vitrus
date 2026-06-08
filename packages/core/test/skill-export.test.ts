import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSkill, skillToBundle, slugifyName } from "../src/skill/skill-export.js";
import { validateSkillFile } from "../src/skill/skill-file.js";
import type { ThinkResult } from "../src/core/types.js";

function result(): ThinkResult {
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

test("slugifyName: Türkçe → [a-z0-9-], <=64", () => {
  assert.equal(slugifyName("Incident Nasıl Çözülür?"), "incident-nasil-cozulur");
  assert.equal(slugifyName(""), "skill");
  assert.ok(/^[a-z0-9-]+$/.test(slugifyName("Çok Şaşırtıcı Ğüöç")));
});

test("buildSkill: geçerli Agent Skill üretir (standart kurallarından geçer)", () => {
  const skill = buildSkill("incident nasıl çözülür", result());
  const v = validateSkillFile(skill);
  assert.deepEqual(v, { ok: true, errors: [] });
  assert.equal(skill.name, "incident-nasil-cozulur");
});

test("buildSkill: canlı Vitrus tool çağrıları gövdeye gömülür (donmuş değil)", () => {
  const skill = buildSkill("incident", result());
  assert.deepEqual(skill.tools, ["Vitrus:search", "Vitrus:provenance", "Vitrus:gap_report"]);
  assert.match(skill.body, /Vitrus:search/);
  assert.match(skill.body, /Vitrus:gap_report/);
  assert.match(skill.body, /canlı bağlı/);
});

test("buildSkill: bilinen boşluklar + provenance skill'e taşınır (glass-box)", () => {
  const skill = buildSkill("incident", result());
  assert.match(skill.body, /tek-nokta/); // gap export edildi
  assert.equal(skill.provenance.length, 2);
  assert.equal(skill.provenance[0].slug, "durable/policies/incident-response");
});

test("skillToBundle: SKILL.md + reference/ dosyaları", () => {
  const bundle = skillToBundle(buildSkill("incident", result()));
  const paths = bundle.files.map((f) => f.path);
  assert.ok(paths.includes("incident/SKILL.md"));
  assert.ok(paths.includes("incident/reference/kaynaklar.md"));
  const md = bundle.files.find((f) => f.path === "incident/SKILL.md")!.content;
  assert.match(md, /^---\nname: incident\n/); // geçerli frontmatter
});
