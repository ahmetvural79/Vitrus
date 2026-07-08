// packages/whatsapp/src/agent.ts
// WhatsApp köprüsü — Baileys linked-device (RESMİ-OLMAYAN). Gerçek gruplara girer.
// GÜVENLİK PROFİLİ: read-mostly — yalnız DOĞRUDAN çağrılınca cevap verir, asla ilk
// mesajı atmaz (en düşük ban-riski). Rıza: /vitrus off ile grup ingestion durur.
// UYARI: WhatsApp ToS gri alanı + KALICI ban riski → yalnız SENİN sahip olduğun
// burner numarayı bağla; ingestion numarasını asla başka bir şeye yük yapma.

import baileys, {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WASocket,
  type WAMessage,
} from "@whiskeysockets/baileys";

// Baileys default-export'u 6.7 (default `makeWASocket`) ↔ 6.17+ (named `makeWASocket`) arası
// değişti → sürümden bağımsız çöz (aksi halde "not callable" tipi/çalışma hatası).
const makeWASocket = ((baileys as any)?.makeWASocket ?? (baileys as any)?.default ?? baileys) as (
  config: Record<string, unknown>,
) => WASocket;
import pino from "pino";
import qrcode from "qrcode-terminal";
import {
  formatAnswerForWhatsApp,
  isAddressedToBot,
  parseControlCommand,
  stripTrigger,
  waGroupMessageToRecord,
  type WaGroupMessage,
} from "./record.js";
import type { IngestClient } from "./ingest.js";

export interface AgentConfig {
  authDir: string; // Baileys oturum klasörü (useMultiFileAuthState)
  ingest: IngestClient;
  trigger?: string; // çağrı kelimesi (varsayılan "vitrus")
  allowGroups?: string[] | null; // izinli grup JID-local'leri; null = hepsi
  retentionDays?: number; // KVKK TTL (gün)
  replyCooldownMs?: number; // grup-başına cevap aralığı (humanize + ban azaltımı)
}

const logger = pino({ level: process.env.VITRUS_WA_LOG ?? "warn" });

/** Metin gövdesini WAMessage'ın olası alt-tiplerinden çıkar (v0: metin + caption). */
function extractText(msg: WAMessage): string {
  const m = msg.message as Record<string, any> | null | undefined;
  if (!m) return "";
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    ""
  );
}

function extractMentions(msg: WAMessage): string[] {
  const m = msg.message as Record<string, any> | null | undefined;
  return m?.extendedTextMessage?.contextInfo?.mentionedJid ?? [];
}

/** Baileys oturumunu başlatır, grup mesajlarını dinler; koptuğunda (loggedOut hariç) yeniden bağlanır. */
export async function startWhatsappAgent(cfg: AgentConfig): Promise<WASocket> {
  const trigger = cfg.trigger ?? "vitrus";
  const cooldown = cfg.replyCooldownMs ?? 4000;
  const optedOut = new Set<string>(); // ingestion kapalı gruplar (grup-local)
  const lastReplyAt = new Map<string, number>();
  const subjectCache = new Map<string, string>();

  const { state, saveCreds } = await useMultiFileAuthState(cfg.authDir);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({ version, auth: state, logger, markOnlineOnConnect: false });
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      console.log("\n▶ Scan this QR in WhatsApp → Settings → Linked devices → Link a device:\n");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "open") {
      console.log("✔ WhatsApp connected. Read-mostly: the agent only replies when addressed (say 'vitrus …').");
    }
    if (connection === "close") {
      const code = (lastDisconnect?.error as any)?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      console.log(
        `✗ connection closed (code ${code}).` +
          (loggedOut ? " Logged out — delete the auth dir and re-link." : " Reconnecting…"),
      );
      if (!loggedOut) startWhatsappAgent(cfg).catch((e) => console.error("reconnect failed:", e));
    }
  });

  async function subjectOf(jid: string): Promise<string | undefined> {
    if (subjectCache.has(jid)) return subjectCache.get(jid);
    try {
      const meta = await sock.groupMetadata(jid);
      if (meta?.subject) {
        subjectCache.set(jid, meta.subject);
        return meta.subject;
      }
    } catch {
      /* grup metadata alınamadı — yoksay */
    }
    return undefined;
  }

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      try {
        const jid = msg.key.remoteJid ?? "";
        if (!jid.endsWith("@g.us")) continue; // yalnız gruplar
        if (msg.key.fromMe) continue; // kendi mesajımız değil
        const groupLocal = jid.replace(/[:@].*$/, "");
        if (cfg.allowGroups && !cfg.allowGroups.includes(groupLocal)) continue; // izinli değil

        // GÖRSEL: resmi indir → base64 → server AI (vision) ile açıklar (metinden ÖNCE; caption görsel düğümüne gömülür).
        const imgMsg = (msg.message as Record<string, any> | null | undefined)?.imageMessage;
        if (imgMsg) {
          if (optedOut.has(groupLocal)) continue; // rıza yok → indirme
          try {
            const buf = (await downloadMediaMessage(msg, "buffer", {}, {
              logger,
              reuploadRequest: sock.updateMediaMessage,
            })) as Buffer;
            await cfg.ingest.ingest(
              [],
              [
                {
                  sourceId: msg.key.id ?? `${jid}:${msg.messageTimestamp}`,
                  groupJid: jid,
                  groupSubject: await subjectOf(jid),
                  senderName: msg.pushName ?? undefined,
                  senderJid: msg.key.participant ?? undefined,
                  tsSeconds:
                    typeof msg.messageTimestamp === "number"
                      ? msg.messageTimestamp
                      : Number(msg.messageTimestamp) || undefined,
                  mime: imgMsg.mimetype ?? "image/jpeg",
                  dataB64: buf.toString("base64"),
                  caption: imgMsg.caption ?? undefined,
                },
              ],
            );
          } catch (err) {
            logger.error({ err }, "image download/ingest failed");
          }
          continue; // görseller Q&A tetiklemez
        }

        // SES: resmi indir → base64 → server AI (Gemini) ile deşifre eder (Q&A tetiklemez).
        const audMsg = (msg.message as Record<string, any> | null | undefined)?.audioMessage;
        if (audMsg) {
          if (optedOut.has(groupLocal)) continue; // rıza yok → indirme
          try {
            const buf = (await downloadMediaMessage(msg, "buffer", {}, {
              logger,
              reuploadRequest: sock.updateMediaMessage,
            })) as Buffer;
            await cfg.ingest.ingest(
              [],
              [],
              [
                {
                  sourceId: msg.key.id ?? `${jid}:${msg.messageTimestamp}`,
                  groupJid: jid,
                  groupSubject: await subjectOf(jid),
                  senderName: msg.pushName ?? undefined,
                  senderJid: msg.key.participant ?? undefined,
                  tsSeconds:
                    typeof msg.messageTimestamp === "number"
                      ? msg.messageTimestamp
                      : Number(msg.messageTimestamp) || undefined,
                  mime: audMsg.mimetype ?? "audio/ogg; codecs=opus",
                  dataB64: buf.toString("base64"),
                  seconds: typeof audMsg.seconds === "number" ? audMsg.seconds : undefined,
                  ptt: audMsg.ptt ?? undefined,
                },
              ],
            );
          } catch (err) {
            logger.error({ err }, "audio download/ingest failed");
          }
          continue; // sesler Q&A tetiklemez
        }

        const text = extractText(msg);
        if (!text.trim()) continue; // metin yoksa (ve görsel değilse) atla

        // 1) Kontrol/rıza komutları (opt-out) — KVKK
        const ctl = parseControlCommand(text);
        if (ctl === "off") {
          optedOut.add(groupLocal);
          await reply(sock, jid, "Vitrus stopped for this group. New messages won't be captured. Turn on: /vitrus on");
          continue;
        }
        if (ctl === "on") {
          optedOut.delete(groupLocal);
          await reply(sock, jid, "Vitrus is active in this group. Messages feed the company brain. Stop: /vitrus off");
          continue;
        }
        if (optedOut.has(groupLocal)) continue; // rıza yok → hiçbir şey yapma

        // 2) Ingestion — mesajı beyne aktar
        const wa: WaGroupMessage = {
          groupJid: jid,
          groupSubject: await subjectOf(jid),
          msgId: msg.key.id ?? `${jid}:${msg.messageTimestamp}`,
          senderJid: msg.key.participant ?? (msg as any).participant ?? "unknown",
          senderName: msg.pushName ?? undefined,
          text,
          tsSeconds:
            typeof msg.messageTimestamp === "number"
              ? msg.messageTimestamp
              : Number(msg.messageTimestamp) || undefined,
          mentions: extractMentions(msg),
        };
        await cfg.ingest.ingest([waGroupMessageToRecord(wa, { retentionDays: cfg.retentionDays })]);

        // 3) Reaktif Q&A — YALNIZ doğrudan çağrılınca (read-mostly)
        if (isAddressedToBot(text, wa.mentions, sock.user?.id, trigger)) {
          const now = Date.now();
          if (now - (lastReplyAt.get(groupLocal) ?? 0) < cooldown) continue; // throttle
          lastReplyAt.set(groupLocal, now);
          const question = stripTrigger(text, trigger);
          const ans = await cfg.ingest.ask(question, jid);
          await reply(sock, jid, formatAnswerForWhatsApp(ans));
        }
      } catch (err) {
        logger.error({ err }, "message handler failed");
      }
    }
  });

  return sock;
}

/** Küçük gecikmeli gönderim → daha insansı, ban azaltımı. */
async function reply(sock: WASocket, jid: string, text: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 600 + (text.length % 400)));
  await sock.sendMessage(jid, { text });
}
