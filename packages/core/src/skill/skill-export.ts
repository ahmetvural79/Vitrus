// src/skill/skill-export.ts
// skill_export — ASIL ÜRÜN ÇIKTISI. Bir iş akışını CANLI Vitrus beynine bağlı,
// çalıştırılabilir bir Agent Skill (SKILL.md) bundle'ına çevirir.
//
// İlkeler:
// - CANLI bağlı: gövdeye donmuş cevap değil, Vitrus:search/provenance/gap_report
//   tool çağrıları gömülür → skill her çalıştığında güncel beyni okur.
// - Glass-box taşınır: export anındaki bilinen boşluklar skill'e yazılır (ajan
//   "beynin bilmediğini" gözardı etmesin).
// - Geçerli standart: çıktı validateSkillFile'dan geçer (SKILL.md frontmatter kuralları).

import type { ThinkResult, SkillFile, SkillReference } from "../core/types.js";
import { skillFileToMarkdown } from "./skill-file.js";
import { buildSkillEval, serializeSkillEval, type SkillEvalSpec } from "./skill-eval.js";

const VITRUS_TOOLS = ["Vitrus:search", "Vitrus:provenance", "Vitrus:gap_report"];

const GAP_TR: Record<string, string> = {
  missing: "eksik",
  contradiction: "çelişki",
  stale: "bayat",
  uncited: "kaynaksız",
  single_point: "tek-nokta",
};

const TR_ASCII: Record<string, string> = {
  ç: "c", Ç: "c", ş: "s", Ş: "s", ı: "i", İ: "i", ğ: "g", Ğ: "g", ü: "u", Ü: "u", ö: "o", Ö: "o",
};

/** Türkçe başlığı geçerli skill name'ine çevirir: [a-z0-9-], <=64. */
export function slugifyName(s: string): string {
  const ascii = s.replace(/[çÇşŞıİğĞüÜöÖ]/g, (m) => TR_ASCII[m] ?? m);
  return (
    ascii
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "skill"
  );
}

function triggersFrom(topic: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of topic.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (t.length > 2 && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out.slice(0, 5);
}

export interface SkillBundleFile {
  path: string; // <name>/SKILL.md, <name>/reference/...
  content: string;
}
export interface SkillBundle {
  name: string;
  files: SkillBundleFile[];
}

/**
 * Bir ThinkResult'tan SkillFile üretir (saf fonksiyon — test edilebilir).
 * Gövde canlı tool çağrıları + adımlar + bilinen boşluklar içerir.
 */
export function buildSkill(topic: string, r: ThinkResult, version = "0.1.0"): SkillFile {
  const name = slugifyName(topic);
  const triggers = triggersFrom(topic);
  const description =
    `"${topic}" iş akışını Vitrus şirket beyninden çıkarır ve adım adım uygular; ` +
    `${triggers[0] ?? topic} ile ilgili durumlarda kullanılır. Kaynak + boşluk gösterir.`;

  const stepLines = r.citations.map(
    (c, i) => `   - ${c.slug.replace(/^(durable|working|derived)\//, "")} kaynağındaki adımları uygula [${i + 1}].`
  );
  const gapLines = r.gaps.length
    ? r.gaps.map((g) => `   - [${GAP_TR[g.kind] ?? g.kind}] ${g.message}`)
    : ["   - (export anında bilinen boşluk yok)"];

  const body = [
    `# ${topic}`,
    "",
    `Bu skill "${topic}" iş akışını Vitrus şirket beynine **canlı bağlı** çalıştırır`,
    "(donmuş kopya değil): her çalıştırmada güncel kaynaklardan okur.",
    "",
    "## Nasıl çalıştırılır",
    `1. \`Vitrus:search\` çağır — sorgu: "${topic}". İlgili düğümleri getir.`,
    "2. Aşağıdaki kaynaklardaki adımları uygula (her iddia bir kaynağa bağlıdır):",
    ...stepLines,
    "3. `Vitrus:provenance` ile her adımın kaynağını (slug + uri) doğrula.",
    "4. `Vitrus:gap_report` çağır — şu bilinen boşlukları gözardı etme:",
    ...gapLines,
    "",
    "## Güvenilirlik (export anı)",
    `- Kaynak: ${r.citations.length} · Açık boşluk: ${r.gaps.length} · En eski kaynak: ${r.oldestSourceDays} gün · Güven: %${Math.round(
      r.confidence * 100
    )}`,
    "",
    "> Tam kaynak listesi: `reference/kaynaklar.md`. Bilgi beyinde güncellenirse",
    "> bu skill'i yeniden export et (canlı tool çağrıları zaten güncel okur).",
  ].join("\n");

  const sourcesMd = [
    `# Kaynaklar (provenance) — "${topic}"`,
    "",
    ...r.citations.map((c, i) => `- [${i + 1}] ${c.slug}${c.uri ? "  ↗ " + c.uri : ""}`),
  ].join("\n");

  const references: SkillReference[] = [{ path: "reference/kaynaklar.md", content: sourcesMd }];

  return {
    name,
    description: description.slice(0, 1024),
    version,
    triggers,
    tools: VITRUS_TOOLS,
    provenance: r.citations.map((c) => ({ nodeId: c.nodeId, slug: c.slug })),
    body,
    references,
  };
}

/** SkillFile'ı yazılabilir bundle dosyalarına çevirir (SKILL.md + reference/). */
export function skillToBundle(skill: SkillFile): SkillBundle {
  const files: SkillBundleFile[] = [
    { path: `${skill.name}/SKILL.md`, content: skillFileToMarkdown(skill) },
  ];
  for (const ref of skill.references ?? []) {
    files.push({ path: `${skill.name}/${ref.path}`, content: ref.content });
  }
  return { name: skill.name, files };
}

// ---------------------------------------------------------------------------
// Skill PACK — SKILL.md + reference/ + eval/skill.eval.json ("skill pack has tests").
// buildSkill yalnız SKILL.md üretir; buildSkillPack ona DONMUŞ eval'i ekler →
// skill değişebilir ama kaynaklarını unutursa eval FAIL eder.
// ---------------------------------------------------------------------------

export interface SkillPack {
  skill: SkillFile;
  eval: SkillEvalSpec;
}

/** ThinkResult'tan SKILL.md + otomatik eval üretir (saf, deterministik). */
export function buildSkillPack(topic: string, r: ThinkResult, version = "0.1.0"): SkillPack {
  const skill = buildSkill(topic, r, version);
  return { skill, eval: buildSkillEval(topic, r, skill) };
}

/** Paketi yazılabilir bundle'a çevirir: SKILL.md + reference/ + eval/skill.eval.json. */
export function skillPackToBundle(pack: SkillPack): SkillBundle {
  const bundle = skillToBundle(pack.skill);
  bundle.files.push({
    path: `${pack.skill.name}/eval/skill.eval.json`,
    content: serializeSkillEval(pack.eval),
  });
  return bundle;
}
