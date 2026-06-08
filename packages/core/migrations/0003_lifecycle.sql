-- migrations/0003_lifecycle.sql
-- B2 — hafıza yaşam döngüsü politikaları ("some is sensitive, some should expire,
-- some local to a project/role"). İkisi de opsiyonel/nullable — donmuş şemaya GÜVENLİ
-- ekleme; mevcut düğümler etkilenmez (scope/expires_at NULL = global/süresiz).
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS scope TEXT;           -- proje/rol kapsamı (retrieval filtresi)
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ; -- TTL (dream-loop süpürmesi)
CREATE INDEX IF NOT EXISTS nodes_expires_idx ON nodes (expires_at)
  WHERE expires_at IS NOT NULL AND deleted_at IS NULL;
