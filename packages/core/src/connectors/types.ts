// src/connectors/types.ts
// Katman A — Ingestion adaptör arayüzü (açık). Her connector iki şey getirir:
// içerik + izin metadata (ACL). ACL Faz 0'da TOPLANIR, Faz 1'de UYGULANIR (T16).
//
// incremental_sync + prune ingest hattında (idempotent: sourceId + content_hash).

import type { NodeType, Tier, AclEntry, KnowledgeNode } from "../core/types.js";
import { contentHash } from "../sync/markdown.js";

/** Bir kaynaktan gelen tek normalize kayıt (fetch_content + fetch_acl birleşik). */
export interface SourceRecord {
  sourceId: string; // kaynaktaki kararlı dış kimlik (idempotent)
  type: NodeType;
  tier?: Tier; // varsayılan working (ham yakalama)
  title: string;
  content: string; // markdown gövdesi ([[wikilink]] içerebilir → auto-link)
  uri: string | null; // orijinale geri-link
  capturedAt: string | null; // ISO
  acl: AclEntry[]; // izin metadata (kim görebilir)
  slug: string; // kararlı slug, ör. "working/slack/platform/1715..."
  scope?: string; // B2: proje/rol kapsamı
  retentionDays?: number; // B2: capturedAt'tan itibaren TTL (gün) → expiresAt
}

export interface Connector {
  /** provenance connector kimliği: "slack" | "github" | "mcp:..." */
  readonly name: string;
  /**
   * Bu connector'ın SAHİP OLDUĞU slug namespace'i (sonu "/"). Budama buna göre
   * yapılır — connector alanına göre DEĞİL. Böylece manuel import edilmiş ama
   * provenance.connector taşıyan düğümler (ör. durable/people/alice) budanmaz.
   */
  readonly slugPrefix: string;
  /** İçerik + ACL'i çeker (read-only). Tümünü döndürür; incremental ingest'te. */
  fetch(): Promise<SourceRecord[]>;
  /** Grup üyeliği senkronu (doc-ACL'den AYRI hat — F13). Opsiyonel. */
  groups?(): Promise<{ group: string; members: string[] }[]>;
}

/** capturedAt + retentionDays → ISO expiresAt (deterministik; Date.now YOK). */
function expiryFrom(capturedAt: string | null, retentionDays?: number): string | undefined {
  if (!capturedAt || !retentionDays) return undefined;
  const t = Date.parse(capturedAt);
  if (Number.isNaN(t)) return undefined;
  return new Date(t + retentionDays * 86_400_000).toISOString();
}

/** SourceRecord → putNode girdisi (provenance + acl + B2 scope/expiry taşır). */
export function recordToNode(
  connector: string,
  r: SourceRecord
): Omit<KnowledgeNode, "id" | "createdAt" | "updatedAt"> {
  return {
    slug: r.slug,
    type: r.type,
    tier: r.tier ?? "working",
    title: r.title,
    content: r.content.trim(),
    frontmatter: {},
    salience: 0.5,
    provenance: {
      connector,
      sourceId: r.sourceId,
      uri: r.uri,
      capturedAt: r.capturedAt,
    },
    acl: r.acl,
    contentHash: contentHash(r.content),
    scope: r.scope,
    expiresAt: expiryFrom(r.capturedAt, r.retentionDays),
  };
}
