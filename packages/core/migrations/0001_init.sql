-- migrations/0001_init.sql
-- Vitrus — başlangıç şeması (kurumsal şirket beyni).
-- PGLite (Postgres 17 WASM) ve Postgres+pgvector için aynı SQL.
-- Embedding boyutu 1536 (OpenAI text-embedding-3-small). Yerel modelde değiştir.

CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- nodes: markdown ile senkron. Doğruluk kaynağı diskteki .md;
-- bu tablo retrieval için (atılabilir) yansımadır.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nodes (
  id            TEXT PRIMARY KEY,                 -- slug'dan türetilen kararlı id
  slug          TEXT UNIQUE NOT NULL,             -- "durable/people/alice"
  type          TEXT NOT NULL,                    -- person/team/service/decision/...
  tier          TEXT NOT NULL CHECK (tier IN ('working','derived','durable')),
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  frontmatter   JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding     vector(1536),
  tsv           tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  salience      REAL NOT NULL DEFAULT 0.5,
  -- provenance (glass-box "kaynak hangi belge")
  connector     TEXT,
  source_id     TEXT,                             -- idempotent dış kimlik
  uri           TEXT,
  captured_at   TIMESTAMPTZ,
  content_hash  TEXT NOT NULL,
  deleted_at    TIMESTAMPTZ,                      -- soft-delete (git silme yansıması)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vektör araması için HNSW (cosine). m=16 varsayılanını değiştirme.
CREATE INDEX IF NOT EXISTS nodes_embedding_hnsw
  ON nodes USING hnsw (embedding vector_cosine_ops);
-- BM25/keyword için GIN.
CREATE INDEX IF NOT EXISTS nodes_tsv_gin ON nodes USING gin (tsv);
CREATE INDEX IF NOT EXISTS nodes_tier_idx ON nodes (tier) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS nodes_type_idx ON nodes (type) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS nodes_source_uq
  ON nodes (connector, source_id) WHERE source_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- node_acl: izin metadata (Faz 0 toplanır, Faz 1 retrieval'da uygulanır — T16).
-- principal = 'PUBLIC' org-geneli sentinel'i. Boş ACL → fail-closed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS node_acl (
  node_id    TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('user','group','public')),
  principal  TEXT NOT NULL,
  PRIMARY KEY (node_id, kind, principal)
);
CREATE INDEX IF NOT EXISTS node_acl_principal_idx ON node_acl (principal);

-- ---------------------------------------------------------------------------
-- group_members: grup üyeliği senkronu (doc-ACL'den AYRI hat — F13). Connector
-- groups()'tan beslenir. expandPrincipals(user) → user + üye olduğu gruplar.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS group_members (
  group_principal  TEXT NOT NULL,
  member_principal TEXT NOT NULL,
  PRIMARY KEY (group_principal, member_principal)
);
CREATE INDEX IF NOT EXISTS group_members_member_idx ON group_members (member_principal);

-- ---------------------------------------------------------------------------
-- node_chunks: markdown/kod-farkında chunk'lar (T6). Node embedding chunk
-- ortalamasından üretilir; chunk'lar denetlenebilirlik için saklanır (F6 temeli).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS node_chunks (
  node_id  TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  idx      INT NOT NULL,
  content  TEXT NOT NULL,
  PRIMARY KEY (node_id, idx)
);

-- ---------------------------------------------------------------------------
-- edges: öz-bağlanan graf. wikilink'lerden LLM'siz üretilir (sidecar yansıması).
-- Bİ-TEMPORAL (T22, Graphiti deseni) — 4 zaman damgası:
--   valid_from/valid_to : gerçek-dünya zamanı (fact ne zaman doğruydu)
--   created_at/expired_at: sistem zamanı (Vitrus ne zaman öğrendi/geçersiz kıldı)
-- Kenarlar SİLİNMEZ; geçersiz kılınır (expired_at set) → tarih korunur.
-- "şimdi doğru" = expired_at IS NULL · "T'de doğru" = created_at<=T AND (expired_at IS NULL OR expired_at>T)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS edges (
  from_node  TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  to_node    TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  edge_type  TEXT NOT NULL,                       -- works_at/owns/supersedes/...
  confidence REAL NOT NULL DEFAULT 1.0,
  valid_from TIMESTAMPTZ,
  valid_to   TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expired_at TIMESTAMPTZ,                          -- NULL = hâlâ geçerli
  PRIMARY KEY (from_node, to_node, edge_type)
);
-- Mevcut depolar için (CREATE IF NOT EXISTS kolon eklemez):
ALTER TABLE edges ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE edges ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS edges_from_idx ON edges (from_node) WHERE expired_at IS NULL;
CREATE INDEX IF NOT EXISTS edges_to_idx   ON edges (to_node)   WHERE expired_at IS NULL;

-- ---------------------------------------------------------------------------
-- entities: çıkarılan varlıklar, sıklık ve kanonik düğüm.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entities (
  name              TEXT NOT NULL,
  entity_type       TEXT NOT NULL,
  mention_count     INTEGER NOT NULL DEFAULT 1,
  canonical_node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
  PRIMARY KEY (name, entity_type)
);

-- ---------------------------------------------------------------------------
-- audit_log: değişmez retrieval kaydı (Faz 1 / T19) — "doc X'i kim gördü?".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  principal   TEXT NOT NULL,
  query       TEXT NOT NULL,
  returned    TEXT[] NOT NULL DEFAULT '{}',       -- dönen node id'leri
  excluded    TEXT[] NOT NULL DEFAULT '{}'        -- ACL ile elenen node id'leri
);

-- ---------------------------------------------------------------------------
-- Hibrit arama yardımcı fonksiyonu (RRF, k=60). Vektör + BM25 sıralamasını
-- reciprocal rank fusion ile birleştirir. (entity sinyali Faz 1 / T24.)
-- ---------------------------------------------------------------------------
-- q_principals: soran kullanıcının principal seti (user + gruplar). NULL → kısıtsız
-- (CLI/eval/admin). Verilince İNDEKS-KATMANINDA filtre: yalnız public VEYA principal
-- eşleşen düğümler sıralamaya girer → yetkisiz düğüm hiç dönmez (fail-closed).
-- ÜÇ sinyal RRF ile birleşir: vektör (HNSW) + BM25 (içerik tsv) + ENTITY (başlık tsv).
-- entity sinyali: sorgu bir varlık ADINI (düğüm başlığı) içeriyorsa o düğümü öne taşır.
CREATE OR REPLACE FUNCTION hybrid_search(
  q_text       TEXT,
  q_vec        vector(1536),
  k_limit      INT DEFAULT 10,
  rrf_k        INT DEFAULT 60,
  q_principals TEXT[] DEFAULT NULL
) RETURNS TABLE (node_id TEXT, rrf_score REAL, vec_rank INT, bm25_rank INT, ent_rank INT) AS $$
  WITH vis AS (
    SELECT n.id FROM nodes n
    WHERE n.deleted_at IS NULL AND (
      q_principals IS NULL OR EXISTS (
        SELECT 1 FROM node_acl a
        WHERE a.node_id = n.id AND (a.kind = 'public' OR a.principal = ANY(q_principals))
      )
    )
  ),
  vec AS (
    SELECT id, row_number() OVER (ORDER BY embedding <=> q_vec) AS r
    FROM nodes
    WHERE deleted_at IS NULL AND embedding IS NOT NULL AND id IN (SELECT id FROM vis)
    ORDER BY embedding <=> q_vec LIMIT 50
  ),
  bm25 AS (
    SELECT id, row_number() OVER (
      ORDER BY ts_rank_cd(tsv, plainto_tsquery('simple', q_text)) DESC
    ) AS r
    FROM nodes
    WHERE deleted_at IS NULL AND tsv @@ plainto_tsquery('simple', q_text)
      AND id IN (SELECT id FROM vis)
    LIMIT 50
  ),
  ent AS (
    SELECT id, row_number() OVER (
      ORDER BY ts_rank_cd(to_tsvector('simple', title), plainto_tsquery('simple', q_text)) DESC
    ) AS r
    FROM nodes
    WHERE deleted_at IS NULL AND to_tsvector('simple', title) @@ plainto_tsquery('simple', q_text)
      AND id IN (SELECT id FROM vis)
    LIMIT 50
  ),
  ids AS (
    SELECT id FROM vec UNION SELECT id FROM bm25 UNION SELECT id FROM ent
  )
  SELECT
    ids.id AS node_id,
    (COALESCE(1.0/(rrf_k + vec.r), 0) + COALESCE(1.0/(rrf_k + bm25.r), 0)
       + COALESCE(1.0/(rrf_k + ent.r), 0))::real AS rrf_score,
    vec.r::int  AS vec_rank,
    bm25.r::int AS bm25_rank,
    ent.r::int  AS ent_rank
  FROM ids
  LEFT JOIN vec  ON vec.id  = ids.id
  LEFT JOIN bm25 ON bm25.id = ids.id
  LEFT JOIN ent  ON ent.id  = ids.id
  ORDER BY rrf_score DESC
  LIMIT k_limit;
$$ LANGUAGE sql STABLE;
