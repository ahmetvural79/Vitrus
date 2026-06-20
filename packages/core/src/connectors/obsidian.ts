// src/connectors/obsidian.ts
// Obsidian vault IMPORT: bir Obsidian klasörünü (.md + YAML frontmatter + [[wikilink]]) Vitrus
// SourceRecord'larına çevirir → ingest. Obsidian'ın [[Not Adı]] / [[Not|alias]] linklerini vault-içi
// slug'a çözer (Vitrus mentions kenarı olur); çözülemeyen → düz metin (alias/ad). Şemasız + deterministik
// (enjekte dosya listesi + dışarıdan `now`). Vitrus zaten markdown-native → en düşük-sürtünme göç yolu.
import type { Connector, SourceRecord } from "./types.js";
import { parseFrontmatter } from "../sync/markdown.js";
import { NODE_TYPES, PUBLIC_PRINCIPAL, type NodeType, type Tier } from "../core/types.js";

/** Vault'a göreli yol (".md" uzantılı) + ham içerik. */
export interface ObsidianFile {
  path: string;
  content: string;
}

const NODE_TYPE_SET = new Set<string>(NODE_TYPES);
const TIERS = new Set(["working", "derived", "durable"]);

function slugifyPart(s: string): string {
  return s.trim().replace(/\.md$/i, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "note";
}
function pathToSlug(relPath: string, prefix: string): string {
  const parts = relPath.replace(/\.md$/i, "").split("/").map(slugifyPart).filter(Boolean);
  return prefix + parts.join("/");
}
function baseName(relPath: string): string {
  return (relPath.split("/").pop() ?? relPath).replace(/\.md$/i, "");
}
function firstHeading(body: string): string | null {
  const m = body.match(/^\s*#{1,6}\s+(.+?)\s*$/m);
  return m ? m[1].trim() : null;
}

/**
 * Obsidian dosyalarını Vitrus SourceRecord'larına çevir.
 * - frontmatter.type geçerli NodeType ise onu, değilse "note" kullanır; tier benzer (varsayılan working).
 * - [[Not]] / [[Not|alias]] → vault-içi slug çözülürse [[slug]] (mentions), yoksa alias/ad düz metin.
 * - slug dosya yolundan türetilir (slugPrefix altında); acl = org-geneli (kendi notların).
 */
export function obsidianToRecords(files: ObsidianFile[], opts: { now: string; slugPrefix?: string }): SourceRecord[] {
  const prefix = opts.slugPrefix ?? "working/obsidian/";
  // İsim → slug (link çözümü): dosya adı (uzantısız, küçük harf) → slug.
  const nameToSlug = new Map<string, string>();
  for (const f of files) nameToSlug.set(baseName(f.path).toLowerCase(), pathToSlug(f.path, prefix));

  return files.map((f) => {
    const { frontmatter, body } = parseFrontmatter(f.content);
    const type: NodeType = NODE_TYPE_SET.has(frontmatter.type) ? (frontmatter.type as NodeType) : "note";
    const tier = (TIERS.has(frontmatter.tier) ? frontmatter.tier : "working") as Tier;
    const content = body.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) => {
      const slug = nameToSlug.get(target.trim().toLowerCase());
      return slug ? `[[${slug}]]` : alias ?? target;
    });
    return {
      sourceId: f.path,
      type,
      tier,
      title: (frontmatter.title || firstHeading(body) || baseName(f.path)).slice(0, 120),
      content,
      uri: null,
      capturedAt: opts.now,
      acl: [{ kind: "public", principal: PUBLIC_PRINCIPAL }],
      slug: pathToSlug(f.path, prefix),
    };
  });
}

/** Connector sarmalayıcı — `ingest(engine, new ObsidianConnector(files, {now}))` ile beyne alınır. */
export class ObsidianConnector implements Connector {
  readonly name = "obsidian";
  readonly slugPrefix: string;
  constructor(
    private files: ObsidianFile[],
    private opts: { now: string; slugPrefix?: string }
  ) {
    this.slugPrefix = opts.slugPrefix ?? "working/obsidian/";
  }
  async fetch(): Promise<SourceRecord[]> {
    return obsidianToRecords(this.files, { now: this.opts.now, slugPrefix: this.slugPrefix });
  }
}
