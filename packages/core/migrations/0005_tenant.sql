-- migrations/0005_tenant.sql
-- Çok-kiracılık (multi-tenancy): org_id + iki katmanlı izolasyon.
--
-- KATMAN 1 (primer, her yerde): indeks-katmanı **org filtresi** — hybrid_search + getNode + graf
-- sorgularının İÇİNDE (uygulama-katmanı "getir-sonra-ele" DEĞİL). org NULL = tek-kiracı/self-host
-- (kısıtsız, mevcut davranış); org set ise yalnız o kiracının satırları. ACL (belge izni) bunun üstüne biner.
--
-- KATMAN 2 (üretim defense-in-depth): RLS politikaları. Gerçek Postgres'te app bağlantısı NON-SUPERUSER
-- rolle açılır → RLS sert zorlar (uygulama hatası olsa bile çapraz-kiracı satır dönmez). PGLite superuser
-- olduğundan RLS'i BYPASS eder (dev/self-host tek-kiracı) — orada Katman 1 filtresi korur. İkisi üst üste.

-- --- org_id kolonları (NULL = tek-kiracı; eski satırlar NULL kalır → tek-kiracı sorguda görünür) ---
ALTER TABLE nodes         ADD COLUMN IF NOT EXISTS org_id TEXT;
ALTER TABLE edges         ADD COLUMN IF NOT EXISTS org_id TEXT;
ALTER TABLE node_acl      ADD COLUMN IF NOT EXISTS org_id TEXT;
ALTER TABLE node_chunks   ADD COLUMN IF NOT EXISTS org_id TEXT;
ALTER TABLE entities      ADD COLUMN IF NOT EXISTS org_id TEXT;
ALTER TABLE audit_log     ADD COLUMN IF NOT EXISTS org_id TEXT;
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS org_id TEXT;
ALTER TABLE jobs          ADD COLUMN IF NOT EXISTS org_id TEXT;

CREATE INDEX IF NOT EXISTS nodes_org_idx ON nodes (org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS edges_org_idx ON edges (org_id) WHERE expired_at IS NULL;
CREATE INDEX IF NOT EXISTS jobs_org_idx  ON jobs  (org_id);

-- --- KATMAN 2: RLS (üretim Postgres'te non-superuser app rolü zorlar; PGLite bypass eder) ---
-- Politika: app.current_org set edilmemişse kısıtsız (yerel/admin); set ise yalnız o org. NULL-org satırları
-- bir org bağlamında görünmez (IS NOT DISTINCT FROM ile NULL≠'orgA').
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['nodes','edges','node_acl','node_chunks','entities','audit_log','group_members','jobs']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_iso', t);
    EXECUTE format($p$CREATE POLICY %I ON %I USING (
      current_setting('app.current_org', true) IS NULL
      OR org_id IS NOT DISTINCT FROM current_setting('app.current_org', true)
    )$p$, t || '_tenant_iso', t);
  END LOOP;
END $$;

-- --- KATMAN 1: hybrid_search'e q_org filtresi (ACL q_principals ile aynı yerde, vis CTE) ---
CREATE OR REPLACE FUNCTION hybrid_search(
  q_text       TEXT,
  q_vec        vector(1536),
  k_limit      INT DEFAULT 10,
  rrf_k        INT DEFAULT 60,
  q_principals TEXT[] DEFAULT NULL,
  q_org        TEXT DEFAULT NULL
) RETURNS TABLE (node_id TEXT, rrf_score REAL, vec_rank INT, bm25_rank INT, ent_rank INT) AS $$
  WITH vis AS (
    SELECT n.id FROM nodes n
    WHERE n.deleted_at IS NULL
      AND (q_org IS NULL OR n.org_id IS NOT DISTINCT FROM q_org)          -- KİRACI sınırı (org)
      AND (
        q_principals IS NULL OR EXISTS (                                  -- BELGE sınırı (ACL)
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
