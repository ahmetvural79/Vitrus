// src/connectors/notion-import.ts
// Notion markdown EXPORT'unu (klasör: "Page Title <32-hex-id>.md", linkler [text](encoded-path.md)) Vitrus'a alır.
//  - Dosya adındaki 32-hex Notion id ekini temizler (slug/başlık temiz olur).
//  - Başlık ilk "# " heading'den (yoksa temiz dosya adı).
//  - [text](encoded-relative.md) linklerini vault-içi slug'a çözer → [[slug]] (mentions); çözülemeyen → metin.
// Deterministik (enjekte dosya listesi + dışarıdan `now`), şemasız.
import type { Connector, SourceRecord } from "./types.js";
import { PUBLIC_PRINCIPAL } from "../core/types.js";

export interface NotionFile {
  path: string; // export köküne göreli (".md")
  content: string;
}

function stripNotionHash(name: string): string {
  return name.replace(/\.md$/i, "").replace(/\s+[0-9a-f]{32}$/i, "").trim();
}
function slugifyPart(s: string): string {
  return stripNotionHash(s).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "page";
}
function pathToSlug(relPath: string, prefix: string): string {
  const parts = relPath.replace(/\.md$/i, "").split("/").map(slugifyPart).filter(Boolean);
  return prefix + parts.join("/");
}
function firstHeading(body: string): string | null {
  const m = body.match(/^\s*#\s+(.+?)\s*$/m);
  return m ? m[1].trim() : null;
}

export function notionToRecords(files: NotionFile[], opts: { now: string; slugPrefix?: string }): SourceRecord[] {
  const prefix = opts.slugPrefix ?? "working/notion/";
  // decode edilmiş yol (küçük harf) → slug haritası (link çözümü).
  const pathToSlugMap = new Map<string, string>();
  for (const f of files) pathToSlugMap.set(decodeURIComponent(f.path).toLowerCase(), pathToSlug(f.path, prefix));

  return files.map((f) => {
    const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/") + 1) : "";
    const content = f.content.replace(/\[([^\]]*)\]\(([^)]+\.md)\)/gi, (_m, text: string, href: string) => {
      const decoded = decodeURIComponent(href);
      const tgt = pathToSlugMap.get((dir + decoded).toLowerCase()) ?? pathToSlugMap.get(decoded.toLowerCase());
      return tgt ? `[[${tgt}]]` : text || decoded;
    });
    return {
      sourceId: f.path,
      type: "note" as const,
      tier: "working" as const,
      title: (firstHeading(f.content) || stripNotionHash(f.path.split("/").pop() ?? f.path)).slice(0, 120),
      content,
      uri: null,
      capturedAt: opts.now,
      acl: [{ kind: "public", principal: PUBLIC_PRINCIPAL }],
      slug: pathToSlug(f.path, prefix),
    };
  });
}

export class NotionConnector implements Connector {
  readonly name = "notion-import";
  readonly slugPrefix: string;
  constructor(
    private files: NotionFile[],
    private opts: { now: string; slugPrefix?: string }
  ) {
    this.slugPrefix = opts.slugPrefix ?? "working/notion/";
  }
  async fetch(): Promise<SourceRecord[]> {
    return notionToRecords(this.files, { now: this.opts.now, slugPrefix: this.slugPrefix });
  }
}
