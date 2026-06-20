// src/core/engine.ts
// Tek sözleşme: hem PGLite (kişisel/dev) hem Postgres+pgvector (paylaşımlı/ölçek)
// bu arayüzü uygular. CLI ve MCP sunucusu bu arayüzden üretilir.
// "İki motor, tek sözleşme" deseni.

import type {
  KnowledgeNode,
  TypedEdge,
  Entity,
  SearchHit,
  SearchOpts,
  ThinkResult,
  Gap,
  EdgeType,
  SkillFile,
  AuditEntry,
  GraphSnapshot,
} from "./types.js";
import type { JobQueue } from "./job-queue.js";
import type { AttentionItem, AttentionOpts } from "../attention/attention.js";
import type { OpsFinding } from "../ops/ops.js";
import type { Conflict } from "../conflicts/conflicts.js";

export interface BrainEngine {
  // --- yaşam döngüsü ---
  init(): Promise<void>; // şema migration'larını uygula
  doctor(): Promise<{ ok: boolean; issues: string[] }>; // sağlık kontrolü
  close(): Promise<void>;

  // --- yazma (kayıt: markdown+sidecar; bu metotlar türev indeksi günceller) ---
  /** Düğümü yaz/güncelle; embed + auto-link (wikilink kenarları) tetikler. */
  putNode(
    node: Omit<KnowledgeNode, "id" | "createdAt" | "updatedAt">,
    edges?: TypedEdge[]
  ): Promise<KnowledgeNode>;
  deleteNode(slug: string): Promise<void>; // soft-delete (git silme yansıması)
  /** SOC2/retention: soft-delete'li düğümleri KALICI sil (FK cascade: edges/chunks/acl). Sayı döner. */
  purge(opts?: { retentionDays?: number }): Promise<number>;
  /** incremental_sync budaması: slugPrefix namespace'inde, keepSourceIds dışındakileri soft-delete. */
  pruneConnector(slugPrefix: string, keepSourceIds: string[]): Promise<number>;

  // --- okuma: arama ---
  /** Ham hibrit arama: vektör + BM25 (+ entity) + RRF. LLM çağrısı YOK. */
  search(query: string, opts?: SearchOpts): Promise<SearchHit[]>;
  /** Sentezlenmiş cevap + citation + boşluk analizi. Görünürlük yüzeyini besler. */
  think(query: string, opts?: SearchOpts): Promise<ThinkResult>;
  /** İş akışını çalıştırılabilir SKILL.md'ye çevirir (canlı Vitrus tool çağrılı). */
  exportSkill(topic: string, opts?: SearchOpts): Promise<SkillFile>;

  // --- izin (Faz 1 / T16) ---
  /** Grup üyeliği senkronu (doc-ACL'den ayrı hat). */
  setGroupMembers(group: string, members: string[]): Promise<void>;
  /** user → [user, ...üye olduğu gruplar]. Bilinmeyen kullanıcı → [user] (fail-closed). */
  expandPrincipals(user: string): Promise<string[]>;
  /** Append-only audit kaydı sorgula ("doc X'i kim gördü?"). */
  getAudit(filter?: { doc?: string; principal?: string }): Promise<AuditEntry[]>;

  // --- okuma: graf ---
  /** Tek düğümü slug ile getir; principals verilirse ACL uygulanır (yetkisiz → null). */
  getNode(slug: string, principals?: string[]): Promise<KnowledgeNode | null>;
  /** Düğüm id'leri → hafif meta (slug + title). Gap/graph etiketlerini ham slug yerine içerikle gösterir; org-scoped. */
  nodesMeta(ids: string[]): Promise<{ id: string; slug: string; title: string }[]>;
  /** Bi-temporal: varsayılan yalnız "şimdi doğru" (expired_at IS NULL); includeExpired ile tarih; asof ile zaman-yolculuğu (o tarihte canlı kenarlar). */
  getConnections(nodeId: string, maxHops?: number, opts?: { includeExpired?: boolean; asof?: string }): Promise<TypedEdge[]>;
  /** Bir düğümün chunk'ları (denetlenebilirlik — F6). */
  getChunks(slug: string): Promise<{ idx: number; content: string }[]>;
  /** Sorguyu en çok DESTEKLEYEN chunk'lar (skorlu, sıralı) — "hangi chunk cevabı verdi". */
  supportingChunks(slug: string, query: string): Promise<{ idx: number; content: string; score: number }[]>;
  graphQuery(fromSlug: string, edgeType?: EdgeType): Promise<KnowledgeNode[]>;
  listEntities(minMentions?: number): Promise<Entity[]>;
  /** C3: SVG graf görselleştirmesi için düğüm+kenar anlık görüntüsü (bayat/gap işaretli). asof: o tarihteki graf (zaman-yolculuğu). */
  graphSnapshot(opts?: { limit?: number; asof?: string }): Promise<GraphSnapshot>;

  // --- bakım (rüya döngüsü bunları çağırır — Faz 1/2) ---
  refreshEntities(): Promise<void>;
  refreshSalience(): Promise<void>;
  dedupReview(threshold?: number): Promise<{ a: string; b: string; sim: number }[]>;
  /** İki düğümü birleştir: gelen kenarları survivor'a yönlendir, duplicate'i soft-delete. */
  mergeNodes(survivorSlug: string, duplicateSlug: string): Promise<void>;
  /** Süpersede edilmiş (bayat) düğümlerin salience'ını sönümle; sayı döner. */
  decayStale(factor?: number): Promise<number>;
  /** B2: expires_at geçmiş düğümleri soft-delete et (TTL süpürmesi). Sayı döner. */
  expireStale(): Promise<number>;
  findGaps(): Promise<Gap[]>; // bayat / kaynaksız / çelişki / tek-nokta
  /** Operasyonel verimsizlikler (ops-haritası): unowned / bus_factor / bottleneck / broken_handoff. Deterministik. */
  findOps(opts?: { bottleneckThreshold?: number }): Promise<OpsFinding[]>;
  /** Çelişkiler (çift-taraflı + çözüm durumu): "kaynaklar çeliştiğinde Vitrus söyler". */
  findConflicts(): Promise<Conflict[]>;
  /** Proaktif "dikkatini bekleyenler" (v1): bayat kalıcı bilgi + çözülmemiş incident + yaşlanan boşluk. `now` ISO. */
  attention(now: string, opts?: AttentionOpts): Promise<AttentionItem[]>;

  // --- dayanıklı iş kuyruğu (opsiyonel capability; gbrain "durable execution" paritesi) ---
  /** Aynı DB üstünde çalışan iş kuyruğu (enqueue/claim/complete + crash recovery). */
  getQueue?(): JobQueue;
}

/** Embedding sağlayıcısı — OpenAI veya yerel (Ollama) ile değiştirilebilir. */
export interface Embedder {
  dim: number;
  embed(texts: string[]): Promise<number[][]>;
}
