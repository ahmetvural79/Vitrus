-- migrations/0006_tenant_namespace.sql
-- Tenant-scoped id namespacing (D1 sağlamlaştırma).
-- Motor node id'yi org ile öneklendirir (engine.qid: org + "~~" + slugToId(slug)) → aynı slug FARKLI org'da
-- ÇAKIŞMAZ; tekillik node PK'sı (id) üzerinde. Global `slug UNIQUE` kısıtı çok-kiracılığı bozar (iki org aynı
-- slug'ı kullanamaz) → kaldırılır. Tek-kiracıda (org NULL) tekillik yine id PK ile korunur
-- (id = slugToId(slug) → her slug için tek satır; davranış değişmez).
ALTER TABLE nodes DROP CONSTRAINT IF EXISTS nodes_slug_key;

-- Slug aramaları için (slug artık global tekil değil) org+slug indeksi.
CREATE INDEX IF NOT EXISTS nodes_slug_idx ON nodes (slug) WHERE deleted_at IS NULL;

-- nodes_source_uq (connector, source_id) DA global → iki org aynı kaynak kimliğini (ör. aynı Slack mesaj
-- id'si) sync edebilir. Org-scoped'a çevir: COALESCE(org_id,'') ile tek-kiracıda (NULL→'') davranış aynı,
-- çok-kiracıda her org kendi (connector, source_id) namespace'inde.
DROP INDEX IF EXISTS nodes_source_uq;
CREATE UNIQUE INDEX IF NOT EXISTS nodes_source_uq
  ON nodes (COALESCE(org_id, ''), connector, source_id) WHERE source_id IS NOT NULL;

-- group_members PK (group_principal, member_principal) DA global → iki org aynı grup+üyeyi kullanamaz.
-- Org-scoped benzersizliğe çevir (COALESCE(org_id,'')). setGroupMembers org-scoped DELETE+INSERT yapar.
ALTER TABLE group_members DROP CONSTRAINT IF EXISTS group_members_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS group_members_uq
  ON group_members (COALESCE(org_id, ''), group_principal, member_principal);
