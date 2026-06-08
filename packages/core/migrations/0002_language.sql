-- migrations/0002_language.sql
-- Çok-dilli beyin: düğüm içerik dili etiketi (auto-detect: "tr"|"en"|"und").
-- Opsiyonel/nullable — donmuş şemaya GÜVENLİ ekleme; retrieval davranışını
-- değiştirmez (determinizm korunur). idempotent: ADD COLUMN IF NOT EXISTS.
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS language TEXT;
