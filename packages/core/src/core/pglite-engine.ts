// src/core/pglite-engine.ts
// PGLite (WASM Postgres + pgvector) implementasyonu — kişisel/dev beyin.
// T8: gerçek hibrit arama (vektör + BM25 + RRF). Doğruluk kaynağı markdown;
// bu motor TÜREV indekstir, depodan yeniden kurulabilir ("indeks atılabilir").

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";

import type { BrainEngine, Embedder } from "./engine.js";
import type {
  KnowledgeNode,
  TypedEdge,
  Entity,
  SearchHit,
  SearchOpts,
  ThinkResult,
  Gap,
  EdgeType,
  Tier,
  NodeType,
  AclEntry,
  AuditEntry,
  GraphSnapshot,
} from "./types.js";
import { extractEdges, slugToId } from "../sync/wikilinks.js";
import { chunkText, meanPool } from "../sync/chunk.js";
import { tierBoost } from "../search/hybrid.js";
import { RERANK_POOL_FACTOR, type Reranker } from "./reranker.js";
import { JobQueue } from "./job-queue.js";
import { PgliteDriver, type SqlDriver } from "./sql-driver.js";
import { structuralGaps, coverageGap, gapsForNodes, type GapNodeView } from "../gap/gaps.js";
import { operationalFindings, type OpsNodeView, type OpsFinding } from "../ops/ops.js";
import { buildConflicts, type Conflict } from "../conflicts/conflicts.js";
import { computeAttention, type AttentionItem, type AttentionNodeView, type AttentionOpts } from "../attention/attention.js";
import { scoreConfidence } from "../surface/surface.js";
import { ExtractiveSynthesizer, type Synthesizer } from "./synthesizer.js";
import { buildSkill } from "../skill/skill-export.js";
import { detectLanguage } from "../sync/lang-detect.js";
import type { SkillFile } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VALID_TIERS = new Set<Tier>(["working", "derived", "durable"]);
const ORG_SEP = "~~"; // kiracı-scoped id ayırıcı (slug'larda geçmez)

/** number[] → pgvector literal '[v1,v2,...]'. */
function vecLiteral(v: number[]): string {
  return "[" + v.join(",") + "]";
}

/** timestamptz (Date|string) → ISO string. */
function toISO(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

interface NodeRow {
  id: string;
  slug: string;
  type: NodeType;
  tier: Tier;
  title: string;
  content: string;
  frontmatter: Record<string, unknown> | null;
  salience: number;
  connector: string | null;
  source_id: string | null;
  uri: string | null;
  captured_at: Date | string | null;
  content_hash: string;
  language?: string | null;
  scope?: string | null;
  expires_at?: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface HitRow extends NodeRow {
  rrf_score: number;
  vec_rank: number | null;
  bm25_rank: number | null;
  ent_rank: number | null;
  cos_dist: number | null;
}

function rowToNode(r: NodeRow): KnowledgeNode {
  return {
    id: r.id,
    slug: r.slug,
    type: r.type,
    tier: r.tier,
    title: r.title,
    content: r.content,
    frontmatter: r.frontmatter ?? {},
    salience: r.salience,
    provenance: {
      connector: r.connector,
      sourceId: r.source_id,
      uri: r.uri,
      capturedAt: r.captured_at ? toISO(r.captured_at) : null,
    },
    acl: [], // ACL retrieval'da uygulanır (T16); arama sonucunda taşınmaz
    createdAt: toISO(r.created_at),
    updatedAt: toISO(r.updated_at),
    contentHash: r.content_hash,
    language: r.language ?? undefined,
    scope: r.scope ?? undefined,
    expiresAt: r.expires_at ? toISO(r.expires_at) : undefined,
  };
}

function stubTier(slug: string): Tier {
  const seg = slug.split("/")[0] as Tier;
  return VALID_TIERS.has(seg) ? seg : "working";
}

export class PgliteEngine implements BrainEngine {
  private db: SqlDriver;
  private embedder: Embedder;
  private synthesizer: Synthesizer;
  private reranker?: Reranker;
  private _queue?: JobQueue;
  /** Kiracı (org) bağlamı. undefined = tek-kiracı/self-host (kısıtsız, mevcut davranış). */
  private org?: string;

  constructor(opts: { dataDir?: string; embedder: Embedder; synthesizer?: Synthesizer; reranker?: Reranker; driver?: SqlDriver; org?: string }) {
    this.embedder = opts.embedder;
    this.org = opts.org;
    // Varsayılan: deterministik çıkarımsal sentez (offline). LLM aynı arayüzden takılır.
    this.synthesizer = opts.synthesizer ?? new ExtractiveSynthesizer();
    // Reranker opsiyonel + varsayılan kapalı (verilmezse search davranışı değişmez).
    this.reranker = opts.reranker;
    // Sürücü verilirse onu kullan (PostgresEngine PgDriver geçirir); yoksa PGLite (varsayılan).
    // dataDir verilmezse bellek-içi (test); CLI kalıcı dizin verir.
    this.db =
      opts.driver ??
      new PgliteDriver(
        opts.dataDir
          ? new PGlite(opts.dataDir, { extensions: { vector } })
          : new PGlite({ extensions: { vector } })
      );
  }

  async init(): Promise<void> {
    // Migration'lar sırayla (idempotent). 0002: çok-dilli `language` kolonu.
    for (const file of ["0001_init.sql", "0002_language.sql", "0003_lifecycle.sql", "0004_jobs.sql", "0005_tenant.sql", "0006_tenant_namespace.sql"]) {
      const sql = readFileSync(join(__dirname, "../../migrations", file), "utf8");
      await this.db.exec(sql);
    }
  }

  async doctor() {
    const issues: string[] = [];
    const { rows } = await this.db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM nodes WHERE deleted_at IS NULL"
    );
    const count = rows[0]?.n ?? 0;
    if (count === 0) issues.push("hiç düğüm yok (import gerekebilir)");
    return { ok: issues.length === 0, issues };
  }

  async close() {
    await this.db.close();
  }

  /** Dayanıklı iş kuyruğu (aynı PGlite DB; init() 0004_jobs migration'ını uygular). */
  getQueue(): JobQueue {
    return (this._queue ??= new JobQueue(this.db));
  }

  /** Kiracı-scoped id: org varsa global id'yi org ile öneklendir; org yoksa global (mevcut davranış). */
  private qidOf(globalId: string): string {
    return this.org ? this.org + ORG_SEP + globalId : globalId;
  }
  private qid(slug: string): string {
    return this.qidOf(slugToId(slug));
  }
  /** Org-prefixli id'den öneksiz slug'ı geri çıkar. */
  private unqid(id: string): string {
    return this.org && id.startsWith(this.org + ORG_SEP) ? id.slice(this.org.length + ORG_SEP.length) : id;
  }

  /** Bir slug için (yoksa) içeriksiz stub düğüm oluşturur — FK + gap analizi. id kiracı-scoped. */
  private async ensureStub(id: string): Promise<void> {
    const slug = this.unqid(id); // stub'un slug'ı öneksiz; org_id ayrı kolonda
    await this.db.query(
      `INSERT INTO nodes (id, slug, type, tier, title, content, frontmatter, salience, content_hash, org_id)
       VALUES ($1, $2, 'note', $3, $4, '', '{"stub":true}'::jsonb, 0.3, '', $5)
       ON CONFLICT (id) DO NOTHING`,
      [id, slug, stubTier(slug), slug.split("/").pop() ?? slug, this.org ?? null]
    );
  }

  async putNode(
    node: Omit<KnowledgeNode, "id" | "createdAt" | "updatedAt">,
    edges?: TypedEdge[]
  ): Promise<KnowledgeNode> {
    const gid = slugToId(node.slug); // global id (org-bağımsız)
    const id = this.qidOf(gid); // kiracı-scoped id (org varsa öneklenir → aynı slug org'lar arası çakışmaz)
    // T6: markdown/kod-farkında chunk → her chunk embed → mean-pool node embedding.
    // Kısa içerik (tek chunk) → embedding = o vektör (davranış değişmez).
    const chunks = chunkText(node.content);
    const chunkVecs = await this.embedder.embed(chunks.map((c) => c.content));
    const embedding = meanPool(chunkVecs);
    const p = node.provenance;
    // Çok-dilli beyin: içerik dili (verilmemişse auto-detect).
    const language = node.language ?? detectLanguage(node.content);

    const { rows } = await this.db.query<{ created_at: Date | string; updated_at: Date | string }>(
      `INSERT INTO nodes
         (id, slug, type, tier, title, content, frontmatter, embedding,
          salience, connector, source_id, uri, captured_at, content_hash, language, scope, expires_at, org_id, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::vector,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, now())
       ON CONFLICT (id) DO UPDATE SET
         slug=EXCLUDED.slug, type=EXCLUDED.type, tier=EXCLUDED.tier, title=EXCLUDED.title,
         content=EXCLUDED.content, frontmatter=EXCLUDED.frontmatter, embedding=EXCLUDED.embedding,
         salience=EXCLUDED.salience, connector=EXCLUDED.connector, source_id=EXCLUDED.source_id,
         uri=EXCLUDED.uri, captured_at=EXCLUDED.captured_at, content_hash=EXCLUDED.content_hash,
         language=EXCLUDED.language, scope=EXCLUDED.scope, expires_at=EXCLUDED.expires_at, org_id=EXCLUDED.org_id,
         deleted_at=NULL, updated_at=now()
       RETURNING created_at, updated_at`,
      [
        id,
        node.slug,
        node.type,
        node.tier,
        node.title,
        node.content,
        JSON.stringify(node.frontmatter ?? {}),
        vecLiteral(embedding),
        node.salience,
        p.connector,
        p.sourceId,
        p.uri,
        p.capturedAt,
        node.contentHash,
        language,
        node.scope ?? null,
        node.expiresAt ?? null,
        this.org ?? null,
      ]
    );

    // ACL'i tazele (Faz 0: toplanır; Faz 1/T16: retrieval'da uygulanır).
    await this.db.query("DELETE FROM node_acl WHERE node_id=$1", [id]);
    for (const a of node.acl) {
      await this.db.query(
        "INSERT INTO node_acl (node_id, kind, principal, org_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        [id, a.kind, a.principal, this.org ?? null]
      );
    }

    // Kenarları Bİ-TEMPORAL tazele (silme değil, geçersiz kıl — tarih korunur).
    // extractEdges GLOBAL id üretir (fromId=gid, toId=slugToId(hedef)); ikisini de kiracı-scoped'a çevir.
    const resolved = (edges ?? extractEdges(gid, node.content)).map((e) => ({
      ...e,
      fromId: this.qidOf(e.fromId),
      toId: this.qidOf(e.toId),
    }));
    const newKeys = resolved.map((e) => `${e.toId}:${e.type}`);
    // 1) Geçersiz kıl: şu an geçerli ama yeni çıkarımda olmayan kenarları expire et.
    await this.db.query(
      `UPDATE edges SET expired_at=now(), valid_to=COALESCE(valid_to, now())
       WHERE from_node=$1 AND expired_at IS NULL
         AND NOT ((to_node || ':' || edge_type) = ANY($2::text[]))`,
      [id, newKeys]
    );
    // 2) Yeni/canlanan kenarları upsert et (revive → expired_at=NULL, yeni created_at).
    for (const e of resolved) {
      if (e.toId !== id) await this.ensureStub(e.toId);
      await this.db.query(
        `INSERT INTO edges (from_node, to_node, edge_type, confidence, valid_from, valid_to, created_at, expired_at, org_id)
         VALUES ($1,$2,$3,$4,$5,$6, now(), NULL, $7)
         ON CONFLICT (from_node, to_node, edge_type) DO UPDATE SET
           confidence=EXCLUDED.confidence, expired_at=NULL, valid_to=NULL, org_id=EXCLUDED.org_id,
           created_at=CASE WHEN edges.expired_at IS NOT NULL THEN now() ELSE edges.created_at END`,
        [e.fromId, e.toId, e.type, e.confidence, e.validFrom ?? null, e.validTo ?? null, this.org ?? null]
      );
    }

    // Chunk'ları tazele (denetlenebilirlik / F6 temeli).
    await this.db.query("DELETE FROM node_chunks WHERE node_id=$1", [id]);
    for (const c of chunks) {
      await this.db.query("INSERT INTO node_chunks (node_id, idx, content, org_id) VALUES ($1,$2,$3,$4)", [
        id,
        c.idx,
        c.content,
        this.org ?? null,
      ]);
    }

    return {
      ...node,
      id,
      createdAt: toISO(rows[0].created_at),
      updatedAt: toISO(rows[0].updated_at),
    };
  }

  async deleteNode(slug: string): Promise<void> {
    await this.db.query(
      "UPDATE nodes SET deleted_at=now() WHERE slug=$1 AND ($2::text IS NULL OR org_id IS NOT DISTINCT FROM $2)",
      [slug, this.org ?? null]
    );
  }

  async setGroupMembers(group: string, members: string[]): Promise<void> {
    // Grup üyeliği senkronu (doc-ACL'den ayrı). Bu grubu tazele.
    const org = this.org ?? null;
    await this.db.query("DELETE FROM group_members WHERE group_principal=$1 AND org_id IS NOT DISTINCT FROM $2", [group, org]);
    for (const m of members) {
      await this.db.query(
        "INSERT INTO group_members (group_principal, member_principal, org_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
        [group, m, org]
      );
    }
  }

  async expandPrincipals(user: string): Promise<string[]> {
    const { rows } = await this.db.query<{ group_principal: string }>(
      "SELECT group_principal FROM group_members WHERE member_principal=$1 AND ($2::text IS NULL OR org_id IS NOT DISTINCT FROM $2)",
      [user, this.org ?? null]
    );
    return [user, ...rows.map((r) => r.group_principal)];
  }

  async getAudit(filter: { doc?: string; principal?: string } = {}): Promise<AuditEntry[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.doc) {
      params.push(filter.doc);
      where.push(`$${params.length} = ANY(returned)`);
    }
    if (filter.principal) {
      params.push(`%${filter.principal}%`);
      where.push(`principal LIKE $${params.length}`);
    }
    // Kiracı (org) filtresi — A, B'nin audit kayıtlarını görmez.
    params.push(this.org ?? null);
    where.push(`($${params.length}::text IS NULL OR org_id IS NOT DISTINCT FROM $${params.length})`);
    const sql = `SELECT at, principal, query, returned, excluded FROM audit_log
                 ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY at DESC, id DESC`;
    const { rows } = await this.db.query<{
      at: Date | string;
      principal: string;
      query: string;
      returned: string[];
      excluded: string[];
    }>(sql, params);
    return rows.map((r) => ({
      at: toISO(r.at),
      principal: r.principal,
      query: r.query,
      returned: r.returned ?? [],
      excluded: r.excluded ?? [],
    }));
  }

  async purge(opts: { retentionDays?: number } = {}): Promise<number> {
    // KALICI sil — soft-delete'li + retention süresini aşmış düğümler. FK ON DELETE
    // CASCADE: edges/node_chunks/node_acl otomatik silinir; entities canonical → NULL.
    const days = opts.retentionDays ?? 0; // 0 = tüm soft-delete'li hemen
    const { rows } = await this.db.query<{ id: string }>(
      `DELETE FROM nodes
       WHERE deleted_at IS NOT NULL AND deleted_at <= now() - ($1 * interval '1 day')
         AND ($2::text IS NULL OR org_id IS NOT DISTINCT FROM $2)
       RETURNING id`,
      [days, this.org ?? null]
    );
    return rows.length;
  }

  async pruneConnector(slugPrefix: string, keepSourceIds: string[]): Promise<number> {
    // Connector'ın SLUG NAMESPACE'inde buda (connector alanına göre değil) —
    // manuel düğümler korunur. slugPrefix sonu "/" olmalı.
    const { rows } = await this.db.query<{ id: string }>(
      `UPDATE nodes SET deleted_at=now()
       WHERE slug LIKE $1 || '%' AND deleted_at IS NULL
         AND (source_id IS NULL OR NOT (source_id = ANY($2::text[])))
         AND ($3::text IS NULL OR org_id IS NOT DISTINCT FROM $3)
       RETURNING id`,
      [slugPrefix, keepSourceIds, this.org ?? null]
    );
    return rows.length;
  }

  async search(query: string, opts: SearchOpts = {}): Promise<SearchHit[]> {
    const limit = opts.limit ?? 10;
    // Reranker açıkken daha geniş aday havuzu çek (≤50); cross-encoder sonra limit'e indirir.
    const pool = this.reranker ? Math.min(50, Math.max(limit, limit * RERANK_POOL_FACTOR)) : limit;
    const [qvec] = await this.embedder.embed([query]);
    const qlit = vecLiteral(qvec);

    // principals verilirse hybrid_search İÇİNDE ACL filtrelenir (indeks-katmanı,
    // fail-closed). Verilmezse NULL → kısıtsız (CLI/eval/admin).
    const principals = opts.principals ?? null;
    const { rows } = await this.db.query<HitRow>(
      `SELECT h.rrf_score, h.vec_rank, h.bm25_rank, h.ent_rank,
              n.id, n.slug, n.type, n.tier, n.title, n.content, n.frontmatter,
              n.salience, n.connector, n.source_id, n.uri, n.captured_at,
              n.content_hash, n.language, n.scope, n.created_at, n.updated_at,
              (n.embedding <=> $2::vector) AS cos_dist
       FROM hybrid_search($1, $2::vector, $3, 60, $4::text[], $5) h
       JOIN nodes n ON n.id = h.node_id
       WHERE n.deleted_at IS NULL`,
      [query, qlit, pool, principals, this.org ?? null]
    );

    // 0.70 ÜRETİM tabanı cosine benzerliğine uygulanır; dev (bag-of-words)
    // embedder'ında her şeyi eler, bu yüzden varsayılan 0 (kapalı) —
    // gerçek eşik eval setiyle kalibre edilir (T14). Üretim opts.threshold=0.70 verir.
    const floor = opts.threshold ?? 0;

    const hits: SearchHit[] = [];
    for (const r of rows) {
      const cosine = r.cos_dist === null ? null : 1 - r.cos_dist;
      if (floor > 0 && (cosine ?? 0) < floor) continue;
      const boostFactor = tierBoost(r.tier);
      const boosts: Record<string, number> = { tier: boostFactor };
      if (cosine !== null) boosts.cosine = Number(cosine.toFixed(4));
      hits.push({
        node: rowToNode(r),
        score: r.rrf_score * boostFactor,
        vectorRank: r.vec_rank ?? undefined,
        bm25Rank: r.bm25_rank ?? undefined,
        entityRank: r.ent_rank ?? undefined,
        boosts,
      });
    }
    // Reranker (varsayılan kapalı): aday havuzunu cross-encoder ile yeniden sırala.
    // score = rerank skoru olur; boosts.cosine korunur (think güveni/zorluk sinyali bozulmaz).
    let ranked: SearchHit[] = hits;
    if (this.reranker && query.trim() && hits.length > 1) {
      const order = await this.reranker.rerank(
        query,
        hits.map((h) => ({ id: h.node.id, text: h.node.content })),
        limit
      );
      const byId = new Map(hits.map((h) => [h.node.id, h]));
      const out: SearchHit[] = [];
      for (const r of order) {
        const h = byId.get(r.id);
        if (!h) continue;
        out.push({ ...h, score: r.score, boosts: { ...h.boosts, rerank: Number(r.score.toFixed(4)) } });
      }
      ranked = out;
    }

    // score desc; eşitlikte slug — deterministik sıra ("indeks atılabilir" invariantı).
    // B2 scope filtresi (app-katmanı — ACL'in aksine güvenlik sınırı DEĞİL, relevance).
    const scoped = opts.scope ? ranked.filter((h) => h.node.scope == null || h.node.scope === opts.scope) : ranked;
    scoped.sort((a, b) => b.score - a.score || a.node.slug.localeCompare(b.node.slug));
    const result = scoped.slice(0, limit);

    // Audit (append-only): yetkili sorgu + opts.audit → kim/ne gördü + ACL'in eledikleri.
    if (opts.audit && principals !== null) {
      const { rows: allRows } = await this.db.query<{ node_id: string }>(
        "SELECT node_id FROM hybrid_search($1, $2::vector, $3, 60, NULL, $4)",
        [query, qlit, limit, this.org ?? null]
      );
      const returnedIds = result.map((h) => h.node.id);
      const excluded = allRows.map((r) => r.node_id).filter((id) => !returnedIds.includes(id));
      await this.db.query(
        "INSERT INTO audit_log (principal, query, returned, excluded, org_id) VALUES ($1,$2,$3,$4,$5)",
        [principals.join(","), query, returnedIds, excluded, this.org ?? null]
      );
    }
    return result;
  }

  async think(query: string, opts: SearchOpts = {}): Promise<ThinkResult> {
    const hits = await this.search(query, opts);
    const lang = detectLanguage(query); // sorgu dili → sentez + ThinkResult.lang

    // Sentez (deterministik/çıkarımsal varsayılan) — her cümle bir kaynağa bağlı.
    const synth = await this.synthesizer.synthesize(query, hits, { lang });

    // Sorgu-kapsamı boşluğu (GapView) + getirilen düğümlere ilgili yapısal boşluklar.
    const topCosine = hits[0]?.boosts?.cosine ?? null;
    const coverage = coverageGap(query, topCosine);
    const relevant = gapsForNodes(await this.findGaps(), hits.map((h) => h.node.id));
    const gaps = coverage ? [coverage, ...relevant] : relevant;
    const oldest = oldestSourceDays(hits);

    return {
      answer: synth.answer,
      citations: synth.citations,
      gaps,
      oldestSourceDays: oldest,
      confidence: scoreConfidence({
        cites: synth.citations.length,
        gaps: gaps.length,
        oldestDays: oldest,
        topCosine,
      }),
      mode: opts.mode ?? "business",
      lang,
    };
  }

  async exportSkill(topic: string, opts: SearchOpts = {}): Promise<SkillFile> {
    const result = await this.think(topic, opts);
    return buildSkill(topic, result);
  }

  async getNode(slug: string, principals?: string[]): Promise<KnowledgeNode | null> {
    // ACL filtresi SQL'de (yetkisiz → hiç dönmez, fail-closed). principals undef → kısıtsız.
    const p = principals ?? null;
    const { rows } = await this.db.query<NodeRow>(
      `SELECT id, slug, type, tier, title, content, frontmatter, salience,
              connector, source_id, uri, captured_at, content_hash, language, scope, expires_at, created_at, updated_at
       FROM nodes n WHERE slug=$1 AND deleted_at IS NULL
         AND ($3::text IS NULL OR n.org_id IS NOT DISTINCT FROM $3)
         AND ($2::text[] IS NULL OR EXISTS (
           SELECT 1 FROM node_acl a WHERE a.node_id=n.id
             AND (a.kind='public' OR a.principal = ANY($2))
         ))`,
      [slug, p, this.org ?? null]
    );
    if (!rows[0]) return null;
    const node = rowToNode(rows[0]);
    // ACL'i hidrate et (search sonuçlarında taşınmaz; tek düğümde gösterilir).
    const { rows: aclRows } = await this.db.query<{ kind: AclEntry["kind"]; principal: string }>(
      "SELECT kind, principal FROM node_acl WHERE node_id=$1 ORDER BY kind, principal",
      [node.id]
    );
    node.acl = aclRows.map((a) => ({ kind: a.kind, principal: a.principal }));
    return node;
  }

  async getChunks(slug: string): Promise<{ idx: number; content: string }[]> {
    const { rows } = await this.db.query<{ idx: number; content: string }>(
      "SELECT idx, content FROM node_chunks WHERE node_id=$1 AND ($2::text IS NULL OR org_id IS NOT DISTINCT FROM $2) ORDER BY idx",
      [this.qid(slug), this.org ?? null]
    );
    return rows;
  }

  async supportingChunks(
    slug: string,
    query: string
  ): Promise<{ idx: number; content: string; score: number }[]> {
    const chunks = await this.getChunks(slug);
    if (chunks.length === 0) return [];
    const [qv] = await this.embedder.embed([query]);
    const cvs = await this.embedder.embed(chunks.map((c) => c.content));
    const dot = (a: number[], b: number[]) => {
      let s = 0;
      for (let i = 0; i < a.length; i++) s += a[i] * b[i];
      return s; // embedder L2-normalize → dot = cosine
    };
    return chunks
      .map((c, i) => ({ idx: c.idx, content: c.content, score: Number(dot(qv, cvs[i]).toFixed(4)) }))
      .sort((a, b) => b.score - a.score);
  }

  async getConnections(
    nodeId: string,
    maxHops = 1,
    opts: { includeExpired?: boolean; asof?: string } = {}
  ): Promise<TypedEdge[]> {
    // Varsayılan: yalnız "şimdi doğru" kenarlar (expired_at IS NULL). Bi-temporal.
    // asof verilirse ZAMAN-YOLCULUĞU: o tarihte canlı kenarlar (created_at<=asof, henüz expire/valid_to olmamış).
    const includeExpired = opts.includeExpired ?? false;
    const asof = opts.asof ?? null;
    const seen = new Set<string>();
    const out: TypedEdge[] = [];
    let frontier = [this.qid(nodeId)];
    for (let hop = 0; hop < maxHops && frontier.length; hop++) {
      const next: string[] = [];
      for (const from of frontier) {
        const { rows } = await this.db.query<{
          from_node: string;
          to_node: string;
          edge_type: EdgeType;
          confidence: number;
          valid_from: Date | string | null;
          valid_to: Date | string | null;
        }>(
          `SELECT from_node, to_node, edge_type, confidence, valid_from, valid_to
           FROM edges WHERE from_node=$1
             AND ($3::text IS NULL OR org_id IS NOT DISTINCT FROM $3)
             AND (CASE WHEN $4::text IS NOT NULL THEN
                    created_at <= $4::timestamptz
                    AND (expired_at IS NULL OR expired_at > $4::timestamptz)
                    AND (valid_from IS NULL OR valid_from <= $4::timestamptz)
                    AND (valid_to IS NULL OR valid_to > $4::timestamptz)
                  ELSE ($2 OR expired_at IS NULL) END)`,
          [from, includeExpired, this.org ?? null, asof]
        );
        for (const e of rows) {
          const key = `${e.from_node}->${e.to_node}:${e.edge_type}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            fromId: e.from_node,
            toId: e.to_node,
            type: e.edge_type,
            confidence: e.confidence,
            validFrom: e.valid_from ? toISO(e.valid_from) : null,
            validTo: e.valid_to ? toISO(e.valid_to) : null,
          });
          next.push(e.to_node);
        }
      }
      frontier = next;
    }
    return out;
  }

  async graphQuery(fromSlug: string, edgeType?: EdgeType): Promise<KnowledgeNode[]> {
    const id = this.qid(fromSlug);
    const org = this.org ?? null;
    // Yalnız "şimdi doğru" kenarlar (bi-temporal): e.expired_at IS NULL. + kiracı (org) filtresi.
    const sql = edgeType
      ? `SELECT n.* FROM edges e JOIN nodes n ON n.id=e.to_node
         WHERE e.from_node=$1 AND e.edge_type=$2 AND e.expired_at IS NULL AND n.deleted_at IS NULL
           AND ($3::text IS NULL OR n.org_id IS NOT DISTINCT FROM $3)`
      : `SELECT n.* FROM edges e JOIN nodes n ON n.id=e.to_node
         WHERE e.from_node=$1 AND e.expired_at IS NULL AND n.deleted_at IS NULL
           AND ($2::text IS NULL OR n.org_id IS NOT DISTINCT FROM $2)`;
    const params = edgeType ? [id, edgeType, org] : [id, org];
    const { rows } = await this.db.query<NodeRow>(sql, params);
    return rows.map(rowToNode);
  }

  async listEntities(minMentions = 1): Promise<Entity[]> {
    const { rows } = await this.db.query<{
      name: string;
      entity_type: NodeType;
      mention_count: number;
      canonical_node_id: string | null;
    }>(
      "SELECT * FROM entities WHERE mention_count >= $1 AND ($2::text IS NULL OR org_id IS NOT DISTINCT FROM $2) ORDER BY mention_count DESC",
      [minMentions, this.org ?? null]
    );
    return rows.map((r) => ({
      name: r.name,
      entityType: r.entity_type,
      mentionCount: r.mention_count,
      canonicalNodeId: r.canonical_node_id,
    }));
  }

  async refreshEntities(): Promise<void> {
    // Varlıklar graftan DETERMİNİSTİK türetilir (LLM'siz): her referans verilen
    // düğüm bir varlıktır; mention_count = farklı referans veren sayısı.
    // (Stub'lar dahil — referans var ama belgesiz = gerçek varlık + missing gap.)
    // Kiracı-scope: yalnız bu org'un entity'lerini sil + yeniden kur (cross-tenant silmeyi önler).
    // Not: entities PK (name, entity_type) — tam çok-kiracı entity izolasyonu için PK'ya org_id (D1 sonrası).
    const org = this.org ?? null;
    await this.db.query("DELETE FROM entities WHERE ($1::text IS NULL OR org_id IS NOT DISTINCT FROM $1)", [org]);
    await this.db.query(
      `INSERT INTO entities (name, entity_type, mention_count, canonical_node_id, org_id)
       SELECT n.title, n.type, agg.c, n.id, n.org_id
       FROM (SELECT to_node, count(DISTINCT from_node) AS c FROM edges e
             WHERE ($1::text IS NULL OR e.org_id IS NOT DISTINCT FROM $1) GROUP BY to_node) agg
       JOIN nodes n ON n.id = agg.to_node AND n.deleted_at IS NULL
         AND ($1::text IS NULL OR n.org_id IS NOT DISTINCT FROM $1)
       ON CONFLICT (name, entity_type)
         DO UPDATE SET mention_count = entities.mention_count + EXCLUDED.mention_count`,
      [org]
    );
  }

  async refreshSalience(): Promise<void> {
    // Memary deseni: salience = (taban + frekans) × tazelik. DETERMİNİSTİK, LLM'siz.
    // frekans = güncel backlink sayısı (kaç düğüm referans veriyor).
    // tazelik = captured_at/updated_at yaşına göre 180 günde lineer sönüm.
    await this.db.query(
      `UPDATE nodes n SET salience = LEAST(1, GREATEST(0,
         (0.3 + 0.7 * LEAST(1, (
            SELECT count(DISTINCT e.from_node) FROM edges e
            WHERE e.to_node = n.id AND e.expired_at IS NULL
         )::real / 5.0))
         * GREATEST(0, 1 - EXTRACT(EPOCH FROM (now() - COALESCE(n.captured_at, n.updated_at))) / (86400.0 * 180))
       ))
       WHERE n.deleted_at IS NULL AND ($1::text IS NULL OR n.org_id IS NOT DISTINCT FROM $1)`,
      [this.org ?? null]
    );
  }

  async dedupReview(threshold = 0.92) {
    // Embedding-benzerlik kapısı (Mem0 deseni, LLM'siz): cosine ≥ threshold çiftler.
    // <=> = cosine MESAFE; sim = 1 - mesafe. Birleştirme YOK — yalnız aday listesi.
    const { rows } = await this.db.query<{ a: string; b: string; sim: number }>(
      `SELECT a.slug AS a, b.slug AS b, (1 - (a.embedding <=> b.embedding))::real AS sim
       FROM nodes a JOIN nodes b ON a.id < b.id
       WHERE a.deleted_at IS NULL AND b.deleted_at IS NULL
         AND a.embedding IS NOT NULL AND b.embedding IS NOT NULL
         AND (a.embedding <=> b.embedding) <= $1
         AND ($2::text IS NULL OR (a.org_id IS NOT DISTINCT FROM $2 AND b.org_id IS NOT DISTINCT FROM $2))
       ORDER BY sim DESC`,
      [1 - threshold, this.org ?? null]
    );
    return rows;
  }

  async mergeNodes(survivorSlug: string, duplicateSlug: string): Promise<void> {
    const s = this.qid(survivorSlug);
    const d = this.qid(duplicateSlug);
    if (s === d) return;
    // 1) duplicate'e gelen kenarları survivor'a yönlendir (PK çakışmasında atla).
    await this.db.query(
      `UPDATE edges SET to_node=$1
       WHERE to_node=$2 AND from_node <> $1
         AND NOT EXISTS (
           SELECT 1 FROM edges x WHERE x.from_node=edges.from_node AND x.to_node=$1 AND x.edge_type=edges.edge_type
         )`,
      [s, d]
    );
    // 2) duplicate'e ait kalan tüm kenarları temizle (gelen-çakışan + giden).
    await this.db.query("DELETE FROM edges WHERE to_node=$1 OR from_node=$1", [d]);
    // 3) duplicate'i soft-delete.
    await this.db.query("UPDATE nodes SET deleted_at=now() WHERE id=$1", [d]);
  }

  async decayStale(factor = 0.5): Promise<number> {
    // Süpersede edilmiş (bir supersedes kenarının güncel hedefi olan) düğümler bayat.
    const { rows } = await this.db.query<{ id: string }>(
      `UPDATE nodes SET salience = GREATEST(0, salience * $1)
       WHERE deleted_at IS NULL
         AND ($2::text IS NULL OR org_id IS NOT DISTINCT FROM $2)
         AND id IN (
           SELECT to_node FROM edges WHERE edge_type='supersedes' AND expired_at IS NULL
             AND ($2::text IS NULL OR org_id IS NOT DISTINCT FROM $2)
         ) RETURNING id`,
      [factor, this.org ?? null]
    );
    return rows.length;
  }

  async expireStale(): Promise<number> {
    // B2 TTL süpürmesi: expires_at geçmiş düğümleri soft-delete et (now() çağrı anında).
    const { rows } = await this.db.query<{ id: string }>(
      `UPDATE nodes SET deleted_at = now()
       WHERE expires_at IS NOT NULL AND expires_at < now() AND deleted_at IS NULL
         AND ($1::text IS NULL OR org_id IS NOT DISTINCT FROM $1)
       RETURNING id`,
      [this.org ?? null]
    );
    return rows.length;
  }

  async graphSnapshot(opts: { limit?: number; asof?: string } = {}): Promise<GraphSnapshot> {
    const limit = opts.limit ?? 60;
    const asof = opts.asof ?? null; // bi-temporal zaman-yolculuğu: o tarihteki graf
    const { rows: nodeRows } = await this.db.query<{ id: string; slug: string; type: NodeType; tier: Tier }>(
      `SELECT id, slug, type, tier FROM nodes WHERE deleted_at IS NULL
         AND ($2::text IS NULL OR org_id IS NOT DISTINCT FROM $2)
       ORDER BY salience DESC, slug ASC LIMIT $1`,
      [limit + 1, this.org ?? null]
    );
    const truncated = Math.max(0, nodeRows.length - limit);
    const nodes = nodeRows.slice(0, limit);
    const idSet = new Set(nodes.map((n) => n.id));
    const id2slug = new Map(nodes.map((n) => [n.id, n.slug]));

    const { rows: edgeRows } = await this.db.query<{ from_node: string; to_node: string; edge_type: EdgeType }>(
      `SELECT from_node, to_node, edge_type FROM edges
       WHERE ($1::text IS NULL OR org_id IS NOT DISTINCT FROM $1)
         AND (CASE WHEN $2::text IS NOT NULL THEN
                created_at <= $2::timestamptz
                AND (expired_at IS NULL OR expired_at > $2::timestamptz)
                AND (valid_from IS NULL OR valid_from <= $2::timestamptz)
                AND (valid_to IS NULL OR valid_to > $2::timestamptz)
              ELSE expired_at IS NULL END)`,
      [this.org ?? null, asof]
    );
    // bayat = supersede kenarının hedefi; gap = findGaps relatedNodeIds.
    const stale = new Set(edgeRows.filter((e) => e.edge_type === "supersedes").map((e) => e.to_node));
    const gapIds = new Set((await this.findGaps()).flatMap((g) => g.relatedNodeIds));

    return {
      nodes: nodes.map((n) => ({ slug: n.slug, type: n.type, tier: n.tier, stale: stale.has(n.id), hasGap: gapIds.has(n.id) })),
      edges: edgeRows
        .filter((e) => idSet.has(e.from_node) && idSet.has(e.to_node))
        .map((e) => ({ from: id2slug.get(e.from_node)!, to: id2slug.get(e.to_node)!, type: e.edge_type })),
      truncated,
    };
  }

  async findGaps(): Promise<Gap[]> {
    const { rows: nodeRows } = await this.db.query<{
      id: string;
      slug: string;
      type: NodeType;
      content: string;
      frontmatter: Record<string, unknown> | null;
      connector: string | null;
      source_id: string | null;
      uri: string | null;
    }>(
      `SELECT id, slug, type, content, frontmatter, connector, source_id, uri
       FROM nodes WHERE deleted_at IS NULL AND ($1::text IS NULL OR org_id IS NOT DISTINCT FROM $1)`,
      [this.org ?? null]
    );
    const { rows: edgeRows } = await this.db.query<{
      from_node: string;
      to_node: string;
      edge_type: EdgeType;
      confidence: number;
      valid_from: Date | string | null;
      valid_to: Date | string | null;
    }>(
      "SELECT from_node, to_node, edge_type, confidence, valid_from, valid_to FROM edges WHERE expired_at IS NULL AND ($1::text IS NULL OR org_id IS NOT DISTINCT FROM $1)",
      [this.org ?? null]
    );

    const views: GapNodeView[] = nodeRows.map((r) => ({
      id: r.id,
      slug: r.slug,
      type: r.type,
      content: r.content,
      frontmatter: r.frontmatter ?? {},
      connector: r.connector,
      sourceId: r.source_id,
      uri: r.uri,
    }));
    const edges: TypedEdge[] = edgeRows.map((e) => ({
      fromId: e.from_node,
      toId: e.to_node,
      type: e.edge_type,
      confidence: e.confidence,
      validFrom: e.valid_from ? toISO(e.valid_from) : null,
      validTo: e.valid_to ? toISO(e.valid_to) : null,
    }));
    return structuralGaps(views, edges);
  }

  /** Operasyonel verimsizlikler (ops-haritası) — findGaps deseni + redundant_tool için dedupReview (pgvector). */
  async findOps(opts: { bottleneckThreshold?: number; redundantThreshold?: number } = {}): Promise<OpsFinding[]> {
    const { rows: nodeRows } = await this.db.query<{ id: string; slug: string; type: NodeType }>(
      `SELECT id, slug, type FROM nodes WHERE deleted_at IS NULL AND ($1::text IS NULL OR org_id IS NOT DISTINCT FROM $1)`,
      [this.org ?? null]
    );
    const { rows: edgeRows } = await this.db.query<{ from_node: string; to_node: string; edge_type: EdgeType }>(
      "SELECT from_node, to_node, edge_type FROM edges WHERE expired_at IS NULL AND ($1::text IS NULL OR org_id IS NOT DISTINCT FROM $1)",
      [this.org ?? null]
    );
    const views: OpsNodeView[] = nodeRows.map((r) => ({ id: r.id, slug: r.slug, type: r.type }));
    const edges: TypedEdge[] = edgeRows.map((e) => ({ fromId: e.from_node, toId: e.to_node, type: e.edge_type, confidence: 1 }));
    // redundant_tool: embedding-benzer servis çiftleri (pgvector; varsayılan eşik 0.92). Hata → boş.
    let similarPairs: { a: string; b: string; sim: number }[] = [];
    try {
      similarPairs = await this.dedupReview(opts.redundantThreshold ?? 0.92);
    } catch {
      similarPairs = [];
    }
    return operationalFindings(views, edges, { bottleneckThreshold: opts.bottleneckThreshold, similarPairs });
  }

  /** Çelişki çözüm görünümü — contradiction gap'leri + supersedes kenarları + düğüm başlıkları → çift-taraflı Conflict. */
  async findConflicts(): Promise<Conflict[]> {
    const contradictions = (await this.findGaps()).filter((g) => g.kind === "contradiction");
    if (contradictions.length === 0) return [];
    const { rows: nodeRows } = await this.db.query<{ id: string; slug: string; title: string }>(
      `SELECT id, slug, title FROM nodes WHERE deleted_at IS NULL AND ($1::text IS NULL OR org_id IS NOT DISTINCT FROM $1)`,
      [this.org ?? null]
    );
    const map = new Map(nodeRows.map((r) => [r.id, { slug: r.slug, title: r.title }]));
    const { rows: edgeRows } = await this.db.query<{ from_node: string; to_node: string }>(
      "SELECT from_node, to_node FROM edges WHERE edge_type='supersedes' AND expired_at IS NULL AND ($1::text IS NULL OR org_id IS NOT DISTINCT FROM $1)",
      [this.org ?? null]
    );
    const sup: TypedEdge[] = edgeRows.map((e) => ({ fromId: e.from_node, toId: e.to_node, type: "supersedes" as const, confidence: 1 }));
    return buildConflicts(contradictions, sup, map);
  }

  /** Proaktif "dikkatini bekleyenler" (v1) — org-scoped; findGaps deseniyle veri toplar, computeAttention'a verir. */
  async attention(now: string, opts?: AttentionOpts): Promise<AttentionItem[]> {
    const { rows: nodeRows } = await this.db.query<{
      id: string;
      slug: string;
      type: NodeType;
      tier: Tier;
      title: string;
      updated_at: Date | string;
      captured_at: Date | string | null;
    }>(
      `SELECT id, slug, type, tier, title, updated_at, captured_at
       FROM nodes WHERE deleted_at IS NULL AND ($1::text IS NULL OR org_id IS NOT DISTINCT FROM $1)`,
      [this.org ?? null]
    );
    const { rows: edgeRows } = await this.db.query<{ from_node: string; to_node: string; edge_type: EdgeType }>(
      "SELECT from_node, to_node, edge_type FROM edges WHERE expired_at IS NULL AND ($1::text IS NULL OR org_id IS NOT DISTINCT FROM $1)",
      [this.org ?? null]
    );
    const nodes: AttentionNodeView[] = nodeRows.map((r) => ({
      id: r.id,
      slug: r.slug,
      type: r.type,
      tier: r.tier,
      title: r.title,
      updatedAt: toISO(r.updated_at),
      capturedAt: r.captured_at ? toISO(r.captured_at) : null,
    }));
    const edges: TypedEdge[] = edgeRows.map((e) => ({ fromId: e.from_node, toId: e.to_node, type: e.edge_type, confidence: 1 }));
    const gaps = await this.findGaps();
    return computeAttention(nodes, edges, gaps, now, opts);
  }
}

/** Citation'lardaki en eski kaynağın yaşı (gün). Tazelik göstergesi. */
function oldestSourceDays(hits: SearchHit[]): number {
  let oldest = 0;
  const now = Date.now();
  for (const h of hits) {
    const c = h.node.provenance.capturedAt;
    if (!c) continue;
    const t = Date.parse(c);
    if (Number.isNaN(t)) continue;
    const days = Math.floor((now - t) / 86_400_000);
    if (days > oldest) oldest = days;
  }
  return oldest;
}
