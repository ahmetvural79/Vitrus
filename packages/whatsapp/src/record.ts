// packages/whatsapp/src/record.ts
// Saf dönüşüm katmanı — Baileys'e BAĞIMLI DEĞİL, bu yüzden canlı WhatsApp oturumu
// olmadan test edilir. WhatsApp grup mesajı → Vitrus SourceRecord (mevcut connector
// hattına verilir: recordToNode → putNode). "note" tipi + working tier + grup-ACL.

import type { SourceRecord } from "@vitrus/core/connectors";

/** Baileys'ten normalize edilmiş, kütüphaneden bağımsız grup mesajı şekli. */
export interface WaGroupMessage {
  groupJid: string; // "12036...@g.us"
  groupSubject?: string; // grup adı (biliniyorsa)
  msgId: string; // WhatsApp mesaj kimliği (idempotent kaynak-id)
  senderJid: string; // katılımcı JID
  senderName?: string; // pushName
  text: string; // düz metin gövde
  tsSeconds?: number; // unix saniye
  mentions?: string[]; // @-anılan JID'ler
}

export const WA_GROUP_SLUG_PREFIX = "working/whatsapp-group/";

/** "12036@g.us" / "999:1@s.whatsapp.net" → "12036" / "999" (slug/ACL/mention için ek soyulur). */
export function jidLocal(jid: string): string {
  return jid.replace(/[:@].*$/, "");
}

function tsToIso(sec?: number): string | null {
  return typeof sec === "number" && Number.isFinite(sec) && sec > 0
    ? new Date(sec * 1000).toISOString()
    : null;
}

/**
 * Grup mesajını SourceRecord'a çevirir. Her mesaj = bir düğüm (working tier).
 * ACL grup-başına fail-closed: yalnız o WhatsApp grubunu görebilenler.
 * opts.retentionDays verilirse KVKK TTL (capturedAt + gün → expiresAt) uygulanır.
 */
export function waGroupMessageToRecord(
  m: WaGroupMessage,
  opts: { retentionDays?: number } = {},
): SourceRecord {
  const gl = jidLocal(m.groupJid);
  const who = m.senderName?.trim() || jidLocal(m.senderJid);
  const where = m.groupSubject?.trim() || `grup ${gl}`;
  const content = `[${where}] ${who} (wa:${jidLocal(m.senderJid)}): ${m.text}`;
  return {
    sourceId: m.msgId,
    type: "note",
    tier: "working",
    title: `${who}: ${m.text.slice(0, 60)}`,
    content,
    uri: null,
    capturedAt: tsToIso(m.tsSeconds),
    acl: [{ kind: "group", principal: `whatsapp-group:${gl}` }], // fail-closed
    slug: `${WA_GROUP_SLUG_PREFIX}${gl}/${m.msgId}`,
    retentionDays: opts.retentionDays,
  };
}

/**
 * Bot mesajda MUHATAP mı? (read-mostly: yalnız DOĞRUDAN çağrılınca cevap veririz;
 * asla kendiliğinden konuşmayız → en düşük ban-riski profili.)
 *   - metin trigger ile başlıyorsa ("vitrus", "@vitrus", "/vitrus"), veya
 *   - botun JID'i @-anılanlar arasında ise.
 */
export function isAddressedToBot(
  text: string,
  mentions: string[] | undefined,
  botJid: string | undefined,
  trigger = "vitrus",
): boolean {
  const t = text.trim().toLowerCase();
  const trg = trigger.toLowerCase();
  if (t.startsWith(trg) || t.startsWith("@" + trg) || t.startsWith("/" + trg)) return true;
  if (botJid && mentions?.some((j) => jidLocal(j) === jidLocal(botJid))) return true;
  return false;
}

/** Kontrol/rıza komutu: "/vitrus off" → grup ingestion'ı durdur, "/vitrus on" → aç. */
export function parseControlCommand(text: string): "off" | "on" | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (t === "/vitrus off" || t === "vitrus off" || t === "vitrus dur") return "off";
  if (t === "/vitrus on" || t === "vitrus on" || t === "vitrus basla" || t === "vitrus başla") return "on";
  return null;
}

/** Botun muhatap-metninden soruyu ayıkla (baştaki trigger'ı at). */
export function stripTrigger(text: string, trigger = "vitrus"): string {
  return text.trim().replace(new RegExp(`^[@/]?${trigger}[,:\\s]*`, "i"), "").trim();
}

/** think() cevabını WhatsApp metnine biçimle: cevap + kaynaklar + tek satır cam-kutu gap. */
export function formatAnswerForWhatsApp(a: {
  answer: string;
  sources?: { title?: string; slug?: string }[];
  gap?: string | null;
}): string {
  const lines = [a.answer.trim()];
  if (a.sources?.length) {
    const src = a.sources
      .slice(0, 3)
      .map((s, i) => `[${i + 1}] ${s.title || s.slug}`)
      .join("  ");
    lines.push(`\n📎 ${src}`);
  }
  if (a.gap && a.gap.trim()) lines.push(`\n⚠️ Bilmediğim: ${a.gap.trim()}`);
  return lines.join("\n");
}
