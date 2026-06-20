// M3.4: prebuilt skill kütüphanesi — shipped skill'ler GERÇEKTEN geçerli (gated) olmalı.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PREBUILT_SKILLS, findPrebuiltSkill } from "../src/skill/prebuilt.js";
import { validateSkillFile, skillFileToMarkdown, parseSkillMarkdown } from "../src/skill/skill-file.js";
import { TOOL_DEFS } from "../src/mcp/tools.js";

const TOOL_NAMES = new Set(TOOL_DEFS.map((t) => t.name));

test("prebuilt skills: ≥12, isimler benzersiz", () => {
  assert.ok(PREBUILT_SKILLS.length >= 12, `en az 12 skill (şu an ${PREBUILT_SKILLS.length})`);
  const names = PREBUILT_SKILLS.map((s) => s.name);
  assert.equal(new Set(names).size, names.length, "isimler benzersiz olmalı");
});

test("prebuilt skills: hepsi validateSkillFile'dan geçer (bozuk skill shiplenmez)", () => {
  for (const s of PREBUILT_SKILLS) {
    const v = validateSkillFile(s);
    assert.ok(v.ok, `${s.name}: ${v.errors.join("; ")}`);
  }
});

test("prebuilt skills: her tool referansı GERÇEK bir MCP aracıdır (Vitrus:<tool>)", () => {
  for (const s of PREBUILT_SKILLS) {
    assert.ok(s.tools.length > 0, `${s.name} en az bir tool referansı olmalı`);
    for (const t of s.tools) {
      const [server, tool] = t.split(":");
      assert.equal(server, "Vitrus", `${s.name}: tool sunucusu Vitrus olmalı (${t})`);
      assert.ok(TOOL_NAMES.has(tool), `${s.name}: bilinmeyen MCP aracı "${tool}" (TOOL_DEFS'te yok)`);
    }
  }
});

test("prebuilt skills: SKILL.md serialize→parse round-trip korunur", () => {
  const s = findPrebuiltSkill("answer-with-sources")!;
  const parsed = parseSkillMarkdown(skillFileToMarkdown(s));
  assert.equal(parsed.name, s.name);
  assert.equal(parsed.description, s.description);
  assert.deepEqual(parsed.tools, s.tools);
});
