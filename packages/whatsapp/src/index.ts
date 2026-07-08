#!/usr/bin/env node
// packages/whatsapp/src/index.ts
// Vitrus WhatsApp ajanı — CLI giriş noktası (Node üzerinde tsx ile koşar; Baileys Bun'da önerilmez).
// Env:
//   VITRUS_WA_AUTH_DIR   Baileys oturum klasörü      (varsayılan ./.wa-auth)
//   VITRUS_WA_TRIGGER    çağrı kelimesi              (varsayılan "vitrus")
//   VITRUS_WA_GROUPS     izinli grup JID-local'leri (virgülle) — boşsa TÜM gruplar
//   VITRUS_WA_RETENTION  KVKK TTL gün                (opsiyonel)
//   VITRUS_INGEST_URL    cloud-api ingest webhook    (yoksa yerel dosya yakalama)
//   VITRUS_THINK_URL     cloud-api think uç noktası  (Q&A için)
//   VITRUS_API_TOKEN     Bearer token                (HTTP modunda)
import { startWhatsappAgent } from "./agent.js";
import { ingestClientFromEnv } from "./ingest.js";

const authDir = process.env.VITRUS_WA_AUTH_DIR ?? "./.wa-auth";
const groupsEnv = process.env.VITRUS_WA_GROUPS?.trim();
const allowGroups = groupsEnv
  ? groupsEnv.split(",").map((s) => s.trim()).filter(Boolean)
  : null;
const retentionDays = process.env.VITRUS_WA_RETENTION
  ? Number(process.env.VITRUS_WA_RETENTION)
  : undefined;

console.log("Vitrus WhatsApp agent — Phase 0 spike");
console.log("⚠ Unofficial linked-device (Baileys). Use a burner number you own. Read-mostly + opt-out (/vitrus off).");
console.log(
  `auth: ${authDir} | groups: ${allowGroups ? allowGroups.join(",") : "ALL"} | ` +
    `ingest: ${process.env.VITRUS_INGEST_URL ? "HTTP" : "file-capture"}`,
);

await startWhatsappAgent({
  authDir,
  ingest: ingestClientFromEnv(),
  trigger: process.env.VITRUS_WA_TRIGGER ?? "vitrus",
  allowGroups,
  retentionDays,
});
