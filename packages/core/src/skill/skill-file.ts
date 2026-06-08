// src/skill/skill-file.ts
// SkillFile şeması yardımcıları: doğrulama + SKILL.md serileştirme.
// Açık Agent Skills standardına uyumluluğu burada GARANTİ ederiz.
// (skill_export tool'u — T11 — bunun üzerine kurulur.)

import type { SkillFile } from "../core/types.js";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const NAME_RE = /^[a-z0-9-]+$/;
const MAX_NAME = 64;
const MAX_DESC = 1024;
const MAX_BODY_LINES = 500;

// 1. şahıs başlangıçları — description keşif anahtarıdır, 3. şahıs olmalı.
const FIRST_PERSON_RE = /^\s*(i |i'|i can|we |let me|use this skill to help)/i;

/** Agent Skills frontmatter kurallarına göre doğrular. */
export function validateSkillFile(skill: SkillFile): ValidationResult {
  const errors: string[] = [];

  if (!skill.name || !NAME_RE.test(skill.name))
    errors.push("name yalnız [a-z0-9-] içermeli ve boş olmamalı");
  if (skill.name && skill.name.length > MAX_NAME)
    errors.push(`name <= ${MAX_NAME} karakter olmalı`);
  if (/anthropic|claude/i.test(skill.name ?? ""))
    errors.push('name "anthropic"/"claude" içeremez');

  if (!skill.description) errors.push("description zorunlu");
  if (skill.description && skill.description.length > MAX_DESC)
    errors.push(`description <= ${MAX_DESC} karakter olmalı`);
  if (FIRST_PERSON_RE.test(skill.description ?? ""))
    errors.push("description 3. şahıs olmalı (keşif anahtarı)");

  const bodyLines = (skill.body ?? "").split("\n").length;
  if (bodyLines > MAX_BODY_LINES)
    errors.push(
      `gövde <${MAX_BODY_LINES} satır olmalı (uzun içeriği reference/ altına taşı), şu an ${bodyLines}`
    );

  for (const tool of skill.tools ?? []) {
    // MCP tool referansları tam-nitelikli olmalı: "Server:tool"
    if (!/^[\w.-]+:[\w.-]+$/.test(tool))
      errors.push(`tool referansı tam-nitelikli olmalı (Server:tool): "${tool}"`);
  }

  for (const ref of skill.references ?? []) {
    if (ref.path.startsWith("/") || ref.path.includes(".."))
      errors.push(`reference yolu göreli ve güvenli olmalı: "${ref.path}"`);
  }

  return { ok: errors.length === 0, errors };
}

function yamlScalar(s: string): string {
  // YAML düz skalar güvenli değilse tırnakla. `:` yalnız boşluk takip ederse
  // (mapping belirsizliği) sorun; `Vitrus:search` gibi tool ref'leri tırnaksız kalır.
  const needsQuote =
    /: /.test(s) || // colon-space → mapping belirsizliği
    /\s#/.test(s) || // space-hash → yorum
    /[\n"]/.test(s) || // newline/tırnak
    /[:#]$/.test(s) || // sonda colon/hash
    /^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(s) || // başta YAML gösterge karakteri
    s.trim() !== s; // baş/son boşluk
  return needsQuote ? JSON.stringify(s) : s;
}

/**
 * SkillFile'ı geçerli bir SKILL.md metnine serileştirir
 * (frontmatter + gövde). Referanslar ayrı dosyalara yazılır (burada değil).
 */
export function skillFileToMarkdown(skill: SkillFile): string {
  const fm: string[] = ["---"];
  fm.push(`name: ${yamlScalar(skill.name)}`);
  fm.push(`description: ${yamlScalar(skill.description)}`);
  fm.push(`version: ${yamlScalar(skill.version)}`);

  if (skill.triggers.length) {
    fm.push("triggers:");
    for (const t of skill.triggers) fm.push(`  - ${yamlScalar(t)}`);
  }
  if (skill.tools.length) {
    fm.push("tools:");
    for (const t of skill.tools) fm.push(`  - ${yamlScalar(t)}`);
  }
  if (skill.provenance.length) {
    fm.push("provenance:");
    for (const p of skill.provenance)
      fm.push(`  - { nodeId: ${yamlScalar(p.nodeId)}, slug: ${yamlScalar(p.slug)} }`);
  }
  fm.push("---", "");

  return fm.join("\n") + skill.body.trimEnd() + "\n";
}

function unq(s: string): string {
  const t = s.trim();
  return t.startsWith('"') ? (JSON.parse(t) as string) : t;
}

/**
 * SKILL.md'yi SkillFile'a ayrıştırır — marketplace INTEROP (dış skill içe aktar).
 * skillFileToMarkdown'ın tersi (round-trip). Açık Agent Skills standardı.
 */
export function parseSkillMarkdown(md: string): SkillFile {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const fmText = m ? m[1] : "";
  const body = (m ? m[2] : md).trim();

  const skill: SkillFile = {
    name: "",
    description: "",
    version: "0.1.0",
    triggers: [],
    tools: [],
    provenance: [],
    body,
  };
  let listKey: "triggers" | "tools" | "provenance" | null = null;
  for (const line of fmText.split("\n")) {
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && listKey) {
      if (listKey === "provenance") {
        const pm = item[1].match(/nodeId:\s*([^,}]+),\s*slug:\s*([^}]+)/);
        if (pm) skill.provenance.push({ nodeId: unq(pm[1]), slug: unq(pm[2]) });
      } else {
        skill[listKey].push(unq(item[1]));
      }
      continue;
    }
    const kv = line.match(/^([a-zA-Z]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, val] = kv;
    if (key === "triggers" || key === "tools" || key === "provenance") {
      listKey = key;
    } else {
      listKey = null;
      if (key === "name") skill.name = unq(val);
      else if (key === "description") skill.description = unq(val);
      else if (key === "version") skill.version = unq(val);
    }
  }
  return skill;
}
