// packages/whatsapp/src/ingest.ts
// Ingestion istemcisi — WhatsApp köprüsünü Vitrus beynine bağlar. İki mod:
//   FileIngestClient  → yerel JSONL'e yakala (Faz 0 KANITI; beyin gerekmez).
//   HttpIngestClient  → cloud-api webhook'una POST (Faz 2 yolu; prod, çok-kiracı).
// Köprü Node'da (Baileys), core Bun'da koştuğu için runtime bağımlılığı YOK: sadece
// SourceRecord *tipini* alırız ve Vitrus'a HTTP/dosya üzerinden konuşuruz.

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { SourceRecord } from "@vitrus/core/connectors";

export interface AskResult {
  answer: string;
  sources?: { title?: string; slug?: string }[];
  gap?: string | null;
}

/** Grupta paylaşılan görsel — köprü ham base64 + metadata gönderir; server vision ile açıklar. */
export interface GroupImagePayload {
  sourceId: string;
  groupJid: string;
  groupSubject?: string;
  senderName?: string;
  senderJid?: string;
  tsSeconds?: number;
  mime: string;
  dataB64: string;
  caption?: string;
}

/** Grupta paylaşılan ses/sesli not — köprü ham base64 + metadata gönderir; server Gemini ile deşifre eder. */
export interface GroupAudioPayload {
  sourceId: string;
  groupJid: string;
  groupSubject?: string;
  senderName?: string;
  senderJid?: string;
  tsSeconds?: number;
  mime: string;
  dataB64: string;
  seconds?: number; // süre
  ptt?: boolean; // push-to-talk (sesli not)
  caption?: string;
}

export interface IngestClient {
  ingest(records: SourceRecord[], images?: GroupImagePayload[], audios?: GroupAudioPayload[]): Promise<void>;
  ask(question: string, groupJid: string): Promise<AskResult>;
}

/** Faz 0: mesajları yerel dosyaya yakala; ask stub döner (beyin bağlı değilken kanıt). */
export class FileIngestClient implements IngestClient {
  constructor(private file: string) {}
  async ingest(records: SourceRecord[], images: GroupImagePayload[] = [], audios: GroupAudioPayload[] = []): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    for (const r of records) await appendFile(this.file, JSON.stringify(r) + "\n");
    for (const im of images)
      await appendFile(
        this.file,
        JSON.stringify({ __image: true, sourceId: im.sourceId, groupJid: im.groupJid, mime: im.mime, caption: im.caption, bytes: im.dataB64.length }) + "\n",
      );
    for (const au of audios)
      await appendFile(
        this.file,
        JSON.stringify({ __audio: true, sourceId: au.sourceId, groupJid: au.groupJid, mime: au.mime, seconds: au.seconds, ptt: au.ptt, caption: au.caption, bytes: au.dataB64.length }) + "\n",
      );
  }
  async ask(): Promise<AskResult> {
    return {
      answer:
        "Vitrus (Faz 0): brain not wired yet — messages are being captured. " +
        "Set VITRUS_THINK_URL to get live answers.",
      sources: [],
      gap: null,
    };
  }
}

/** Faz 2: cloud-api webhook'una POST (records → ingest, question → think). */
export class HttpIngestClient implements IngestClient {
  constructor(
    private ingestUrl: string,
    private thinkUrl: string | null,
    private token?: string,
  ) {}
  private headers(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (this.token) h["authorization"] = `Bearer ${this.token}`;
    return h;
  }
  async ingest(records: SourceRecord[], images: GroupImagePayload[] = [], audios: GroupAudioPayload[] = []): Promise<void> {
    const res = await fetch(this.ingestUrl, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ op: "ingest", records, images, audios }),
    });
    if (!res.ok) throw new Error(`ingest HTTP ${res.status}`);
  }
  async ask(question: string, groupJid: string): Promise<AskResult> {
    // Aynı /t/<org>/whatsapp-group ucu, op ile ayrılır; ayrı THINK_URL verilmediyse ingest ucu kullanılır.
    const url = this.thinkUrl ?? this.ingestUrl;
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ op: "ask", question, groupJid }),
    });
    if (!res.ok) throw new Error(`ask HTTP ${res.status}`);
    return (await res.json()) as AskResult;
  }
}

/** Env'den istemci seç: VITRUS_INGEST_URL varsa HTTP, yoksa yerel dosya yakalama. */
export function ingestClientFromEnv(): IngestClient {
  const ingestUrl = process.env.VITRUS_INGEST_URL;
  if (ingestUrl) {
    return new HttpIngestClient(
      ingestUrl,
      process.env.VITRUS_THINK_URL ?? null,
      process.env.VITRUS_API_TOKEN,
    );
  }
  return new FileIngestClient(process.env.VITRUS_CAPTURE_FILE ?? "./captured/messages.jsonl");
}
