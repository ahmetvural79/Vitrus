// src/sync/markdown.ts
// Markdown <-> türev indeks senkronizasyonu. Doğruluk kaynağı diskteki .md'dir.
// content_hash değişmemiş dosyaların yeniden embed edilmesini engeller (idempotent).

import { createHash } from "node:crypto";
import type {
  KnowledgeNode,
  NodeType,
  Tier,
  AclEntry,
  AclPrincipalKind,
  Provenance,
} from "../core/types.js";
import { PUBLIC_PRINCIPAL } from "../core/types.js";
import { slugToId } from "./wikilinks.js";

interface ParsedFile {
  frontmatter: Record<string, string>;
  body: string;
}

/** Basit YAML frontmatter ayrıştırıcı (--- ... --- bloğu, key: value). MVP. */
export function parseFrontmatter(raw: string): ParsedFile {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) return { frontmatter: {}, body: raw };

  const frontmatter: Record<string, string> = {};
  for (const line of fmMatch[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key) frontmatter[key] = val;
  }
  return { frontmatter, body: fmMatch[2] };
}

export function contentHash(body: string): string {
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

/**
 * KnowledgeNode → .md metni (frontmatter + gövde). `fileToNode`'un TERSİ (round-trip):
 * bir ajan `remember` ettiğinde hafıza markdown KAYNAĞINA yazılır → reindex'te kaybolmaz
 * (sahiplik invariantı). slug dosya YOLUNDA kodlanır (`<slug>.md`), frontmatter'da değil.
 */
export function nodeToMarkdown(
  node: Pick<KnowledgeNode, "type" | "title" | "content" | "acl" | "provenance" | "salience">
): string {
  const fm: string[] = ["---", `type: ${node.type}`];
  if (node.title) fm.push(`title: ${node.title}`);
  if (node.acl.length)
    fm.push(`acl: ${node.acl.map((a) => (a.kind === "public" ? "public" : `${a.kind}:${a.principal}`)).join(", ")}`);
  const p = node.provenance;
  if (p.connector) fm.push(`connector: ${p.connector}`);
  if (p.sourceId) fm.push(`source_id: ${p.sourceId}`);
  if (p.uri) fm.push(`uri: ${p.uri}`);
  if (p.capturedAt) fm.push(`captured_at: ${p.capturedAt}`);
  fm.push(`salience: ${node.salience}`, "---", "");
  return fm.join("\n") + node.content.trimEnd() + "\n";
}

const VALID_TIERS = new Set<Tier>(["working", "derived", "durable"]);

/**
 * ACL'i frontmatter'dan ayrıştırır. Beklenen biçim (virgülle ayrık):
 *   acl: user:alice, group:eng, public
 * Boşsa [] döner → Faz 1'de fail-closed (org-geneli erişim DEĞİL).
 */
export function parseAcl(raw: string | undefined): AclEntry[] {
  if (!raw) return [];
  const out: AclEntry[] = [];
  for (const part of raw.split(",")) {
    const token = part.trim();
    if (!token) continue;
    if (token === "public" || token === PUBLIC_PRINCIPAL) {
      out.push({ kind: "public", principal: PUBLIC_PRINCIPAL });
      continue;
    }
    const ci = token.indexOf(":");
    if (ci === -1) {
      out.push({ kind: "user", principal: token });
      continue;
    }
    const kindRaw = token.slice(0, ci).trim();
    const principal = token.slice(ci + 1).trim();
    const kind: AclPrincipalKind =
      kindRaw === "group" ? "group" : kindRaw === "public" ? "public" : "user";
    out.push({ kind, principal: kind === "public" ? PUBLIC_PRINCIPAL : principal });
  }
  return out;
}

function deriveTitle(frontmatter: Record<string, string>, body: string, slug: string): string {
  if (frontmatter.title) return frontmatter.title;
  const heading = body.match(/^\s*#\s+(.+)$/m);
  if (heading) return heading[1].trim();
  const base = slug.split("/").pop() ?? slug;
  return base;
}

/**
 * Bir dosya yolu + içerikten KnowledgeNode üretir (id/created/updated hariç).
 * tier: ilk dizin segmenti (working/derived/durable); geçersizse "working".
 * type: frontmatter.type; yoksa "note".
 */
export function fileToNode(
  relPath: string, // örn. "durable/people/alice.md"
  raw: string
): Omit<KnowledgeNode, "id" | "createdAt" | "updatedAt"> {
  const { frontmatter, body } = parseFrontmatter(raw);
  const slug = relPath.replace(/\\/g, "/").replace(/\.md$/, "");
  const firstSeg = slug.split("/")[0] as Tier;
  const tier: Tier = VALID_TIERS.has(firstSeg) ? firstSeg : "working";
  const type = (frontmatter.type as NodeType) ?? "note";
  const trimmedBody = body.trim();

  const salience = frontmatter.salience !== undefined ? Number(frontmatter.salience) : 0.5;

  const provenance: Provenance = {
    connector: frontmatter.connector ?? null,
    sourceId: frontmatter.source_id ?? frontmatter.source ?? null,
    uri: frontmatter.uri ?? null,
    capturedAt: frontmatter.captured_at ?? null,
  };

  return {
    slug,
    type,
    tier,
    title: deriveTitle(frontmatter, body, slug),
    content: trimmedBody,
    frontmatter,
    salience: Number.isFinite(salience) ? salience : 0.5,
    provenance,
    acl: parseAcl(frontmatter.acl),
    contentHash: contentHash(body),
  };
}

export { slugToId };
