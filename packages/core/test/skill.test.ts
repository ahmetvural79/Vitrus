import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSkillFile, skillFileToMarkdown } from "../src/skill/skill-file.js";
import type { SkillFile } from "../src/core/types.js";

function base(): SkillFile {
  return {
    name: "incident-cozumu",
    description:
      "Incident'ların nasıl çözüleceğini şirket beyninden çıkarır; on-call sırasında kullanılır.",
    version: "0.1.0",
    triggers: ["incident", "kesinti"],
    tools: ["Vitrus:search", "Vitrus:provenance"],
    provenance: [{ nodeId: "durable/incidents/x", slug: "durable/incidents/x" }],
    body: "# Incident çözümü\n\n1. Vitrus:search ile geçmiş incident'ları bul.\n",
  };
}

test("geçerli skill doğrulamadan geçer", () => {
  assert.deepEqual(validateSkillFile(base()), { ok: true, errors: [] });
});

test("name kuralları: yalnız [a-z0-9-], claude/anthropic yok", () => {
  const bad = { ...base(), name: "Claude_Skill" };
  const r = validateSkillFile(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 1);
});

test("description 1. şahıs reddedilir (keşif anahtarı 3. şahıs)", () => {
  const r = validateSkillFile({ ...base(), description: "I can help resolve incidents." });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("3. şahıs")));
});

test("tam-nitelikli olmayan tool referansı reddedilir", () => {
  const r = validateSkillFile({ ...base(), tools: ["search"] });
  assert.equal(r.ok, false);
});

test("500+ satır gövde reddedilir", () => {
  const r = validateSkillFile({ ...base(), body: "x\n".repeat(600) });
  assert.equal(r.ok, false);
});

test("skillFileToMarkdown geçerli frontmatter üretir", () => {
  const md = skillFileToMarkdown(base());
  assert.ok(md.startsWith("---\n"));
  assert.ok(md.includes("name: incident-cozumu"));
  assert.ok(md.includes("tools:"));
  assert.ok(md.includes("  - Vitrus:search"));
  assert.ok(md.includes("# Incident çözümü"));
});
