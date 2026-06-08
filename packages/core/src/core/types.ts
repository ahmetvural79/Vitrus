// src/core/types.ts
// Vitrus — DONDURULMUŞ ÇEKİRDEK ŞEMALAR (v1).
//
// Doğruluk kaynağı diskteki markdown + sidecar'dır; bu tipler DB içindeki
// (atılabilir) türev indeksin ve bellek-içi modelin yansımasını temsil eder.
//
// "Şemaları dondur" sözleşmesi: bu dosyadaki alan adları/anlamları kararlıdır.
// İleri uyumluluk için bazı alanlar opsiyoneldir (Faz 1'de doldurulur) — yeni
// ZORUNLU alan eklemek kırıcıdır; opsiyonel eklemek güvenlidir.

// ---------------------------------------------------------------------------
// Kademe & taksonomi
// ---------------------------------------------------------------------------

/** Üç bellek kademesi (Skinner deseni). */
export type Tier = "working" | "derived" | "durable";

/**
 * Şirket beyni düğüm taksonomisi. Kişisel beyin tiplerini (concept/note/...)
 * korur, üzerine kurumsal tipleri (team/service/decision/incident/policy) ekler.
 */
export type NodeType =
  | "person"
  | "team"
  | "service"
  | "decision"
  | "incident"
  | "policy"
  | "company"
  | "concept"
  | "source"
  | "note"
  | "meeting"
  | "document"
  | "session"; // ajan oturum transcript'i (B1 — "repo hafıza değildir")

/** İki çalışma modu. Kurumsal MVP "business" ile başlar (nesne-ağırlıklı). */
export type Mode = "business" | "research";

/**
 * Tipli kenar türleri. Öz-bağlanan grafın omurgası.
 * `supersedes`/`contradicts` deterministik çelişki tespitini besler (Faz 1).
 */
export type EdgeType =
  | "works_at"
  | "member_of"
  | "reports_to" // org hiyerarşisi (person → yönetici)
  | "owns"
  | "depends_on"
  | "attended"
  | "mentions"
  | "extends"
  | "contradicts"
  | "supersedes"
  | "decided_by"
  | "caused_by"
  | "resolved_by"
  | "advises"
  | "founded";

// ---------------------------------------------------------------------------
// İzin metadata (ACL) — Faz 0'da TOPLANIR, Faz 1'de UYGULANIR (T16).
// Düğüm üzerinde donmuş şekil; retrieval anında filtre buradan beslenir.
// ---------------------------------------------------------------------------

export type AclPrincipalKind = "user" | "group" | "public";

/** "PUBLIC" sentinel'i org-geneli erişim demektir (Onyx deseni). */
export const PUBLIC_PRINCIPAL = "PUBLIC";

export interface AclEntry {
  kind: AclPrincipalKind;
  /** Kaynak-tarafı principal kimliği; public için PUBLIC_PRINCIPAL. */
  principal: string;
}

// ---------------------------------------------------------------------------
// Kaynak izi (provenance) — glass-box'ın "kaynak hangi belge" yüzeyini besler.
// ---------------------------------------------------------------------------

export interface Provenance {
  /** Hangi connector getirdi: "slack" | "github" | "manual" | "drive" | ... */
  connector: string | null;
  /** Kaynaktaki kararlı dış kimlik (mesaj/PR/dosya id'si). İdempotent senkron. */
  sourceId: string | null;
  /** Orijinale geri-link (glass-box "Kaynakları aç" akışı). */
  uri: string | null;
  /** Kaynakta oluşma/yakalanma zamanı (ISO). Tazelik analizi için. */
  capturedAt: string | null;
}

// ---------------------------------------------------------------------------
// KnowledgeNode — markdown ile senkron. (Kişisel beyindeki `Page`'in kurumsal
// evrimi.) Doğruluk kaynağı .md; bu, retrieval için yansımadır.
// ---------------------------------------------------------------------------

export interface KnowledgeNode {
  id: string;
  /** "durable/people/alice" — dosya yolundan türetilir. */
  slug: string;
  type: NodeType;
  tier: Tier;
  /** İnsan-okunur başlık (ilk başlık veya frontmatter.title). */
  title: string;
  /** Markdown gövdesi (frontmatter hariç). */
  content: string;
  frontmatter: Record<string, unknown>;
  /** 0..1 — frekans×tazelik ile rüya döngüsünde yeniden hesaplanır (Faz 1). */
  salience: number;
  provenance: Provenance;
  /** İzin metadata. Boşsa fail-closed (Faz 1) — varsayılan org-geneli DEĞİL. */
  acl: AclEntry[];
  createdAt: string; // ISO
  updatedAt: string; // ISO
  /** İdempotent senkron için (değişmemiş dosya yeniden embed edilmez). */
  contentHash: string;
  /** İçerik dili (auto-detect: "tr"|"en"|"und"). Çok-dilli beyin etiketi (opsiyonel). */
  language?: string;
  /** Proje/rol kapsamı (B2) — retrieval'da scope filtresi; null = global. */
  scope?: string;
  /** ISO son-kullanma (B2) — dream-loop TTL süpürmesi soft-delete eder; null = süresiz. */
  expiresAt?: string;
}

// ---------------------------------------------------------------------------
// TypedEdge — öz-bağlanan graf. [[wikilink]]'lerden LLM'siz üretilir.
// ---------------------------------------------------------------------------

export interface TypedEdge {
  fromId: string; // KnowledgeNode id
  toId: string; // KnowledgeNode id
  type: EdgeType;
  confidence: number; // 0..1
  /**
   * Bi-temporal alanlar — Faz 1'de (T22) doldurulur; şimdi opsiyonel/ileri-uyumlu.
   * validFrom/validTo: gerçek dünyada doğru olduğu pencere.
   */
  validFrom?: string | null;
  validTo?: string | null;
}

// ---------------------------------------------------------------------------
// SkillFile — ASIL ÜRÜN ÇIKTISI. Açık Agent Skills (SKILL.md) standardına uyumlu.
// Frontmatter kuralları araştırmadan: name [a-z0-9-] <=64; description 3. şahıs
// <=1024 (keşif anahtarı); gövde <500 satır; reference/ progressive disclosure.
// ---------------------------------------------------------------------------

export interface SkillProvenance {
  /** Bu skill hangi düğümlerden türedi (glass-box izlenebilirlik). */
  nodeId: string;
  slug: string;
}

export interface SkillReference {
  /** SKILL.md'ye göreli yol, ör. "reference/runbook.md". İleri-bölme (L3). */
  path: string;
  content: string;
}

export interface SkillFile {
  // --- Agent Skills standardı frontmatter ---
  /** [a-z0-9-], <=64; "anthropic"/"claude" içeremez. */
  name: string;
  /** 3. şahıs, <=1024; "ne yapar + ne zaman kullanılır". Keşif anahtarı. */
  description: string;

  // --- Vitrus uzantıları ---
  version: string;
  /** Yönlendirme ipuçları (tetikleyici ifadeler). */
  triggers: string[];
  /** Kullanılan tam-nitelikli MCP tool'ları, ör. "Vitrus:search". */
  tools: string[];
  /** Skill hangi kaynak düğümlerden türedi. */
  provenance: SkillProvenance[];
  /** SKILL.md gövdesi (talimat + somut örnek + araç kullanımı). */
  body: string;
  /** L3 progressive-disclosure dosyaları (opsiyonel). */
  references?: SkillReference[];
}

// ---------------------------------------------------------------------------
// Retrieval & düşünme çıktıları (görünürlük yüzeyini besler).
// ---------------------------------------------------------------------------

export interface SearchHit {
  node: KnowledgeNode;
  score: number; // birleşik RRF skoru
  vectorRank?: number;
  bm25Rank?: number;
  entityRank?: number; // entity-match 3. sinyal (Faz 1)
  boosts?: Record<string, number>;
}

export interface SearchOpts {
  limit?: number; // varsayılan 10
  threshold?: number; // varsayılan 0.70
  tier?: Tier;
  type?: NodeType;
  alpha?: number; // semantik ağırlık (1-alpha = lexical), varsayılan 0.5
  /** Faz 1: soran kullanıcının principal seti (ACL filtresi). */
  principals?: string[];
  /** true ise bu (yetkili) sorgu audit_log'a yazılır (kim/sorgu/dönen/elenen). */
  audit?: boolean;
  /** think için mod rozeti (varsayılan business). */
  mode?: Mode;
  /** B2: yalnız bu kapsam (veya global/null) düğümleri getir. */
  scope?: string;
}

/** Değişmez retrieval kaydı ("doc X'i kim gördü?"). */
export interface AuditEntry {
  at: string;
  principal: string; // soran principal seti (virgülle)
  query: string;
  returned: string[]; // dönen node id'leri
  excluded: string[]; // ACL ile elenen node id'leri
}

/** Beynin bilmediği — Katman 4'ün sarı kutusu. */
export interface Gap {
  kind: "stale" | "uncited" | "contradiction" | "missing" | "single_point";
  message: string;
  relatedNodeIds: string[];
}

export interface ThinkResult {
  answer: string; // [n] citation işaretleriyle sentez
  citations: { nodeId: string; slug: string; uri: string | null }[]; // [n] ↔ citations[n-1]
  gaps: Gap[];
  oldestSourceDays: number;
  confidence: number; // 0..1 güven skoru (güvenilirlik kartı)
  mode: Mode; // research | business (kurumsal varsayılan: business)
  lang?: string; // sorgu dili (detectLanguage) — üretim sentezleyici cevabı bu dilde üretir
}

export interface Entity {
  name: string;
  entityType: NodeType;
  mentionCount: number;
  canonicalNodeId: string | null;
}

// ---------------------------------------------------------------------------
// Graf görüntüsü (C3) — sıfır-bağımlılık SVG görselleştirmesini besler.
// ---------------------------------------------------------------------------

export interface GraphNodeView {
  slug: string;
  type: NodeType;
  tier: Tier;
  stale: boolean; // supersede edilmiş (bayat)
  hasGap: boolean; // bir boşluğa dahil
}
export interface GraphEdgeView {
  from: string; // slug
  to: string; // slug
  type: EdgeType;
}
export interface GraphSnapshot {
  nodes: GraphNodeView[];
  edges: GraphEdgeView[];
  truncated: number; // limit nedeniyle çizilmeyen düğüm (sessiz kırpma YOK)
}
