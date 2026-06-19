// src/connectors/gmail-live.ts
// Gmail CANLI connector — REST (OAuth Bearer). slug `working/gmail/<id>`, type document,
// ACL grup `gmail:workspace` (hassas — gerçek dağıtımda kullanıcı-bazlı scope'la daraltılır).
//
// İki-aşamalı: messages.list (pageToken pagination, http.paginateCursor) → her id için
// messages.get?format=full → MIME payload'dan text/plain çıkar (base64url decode, recursive).
// Incremental: q=after:<unix-sec>.

import type { Connector, SourceRecord } from "./types.js";
import type { AclEntry } from "../core/types.js";
import { type HttpFetch, defaultFetch, getJson, paginateCursor } from "./http.js";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailLiveOpts {
  token: string; // OAuth access token (Bearer)
  since?: string; // ISO → q=after:<unix>
  fetchImpl?: HttpFetch;
  maxPages?: number;
}

function b64urlDecode(s: string): string {
  try {
    return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return "";
  }
}
function headerVal(payload: any, name: string): string {
  const h = (payload?.headers ?? []).find((x: any) => String(x.name).toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}
/** MIME ağacından ilk text/plain gövdeyi çıkar (recursive). */
function plainText(payload: any): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) return b64urlDecode(payload.body.data);
  for (const part of payload.parts ?? []) {
    const t = plainText(part);
    if (t) return t;
  }
  return payload.body?.data ? b64urlDecode(payload.body.data) : "";
}

export class GmailLiveConnector implements Connector {
  readonly name = "gmail";
  readonly slugPrefix = "working/gmail/";
  private readonly fetchImpl: HttpFetch;
  constructor(private readonly opts: GmailLiveOpts) {
    this.fetchImpl = opts.fetchImpl ?? defaultFetch;
  }
  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.opts.token}` };
  }

  async fetch(): Promise<SourceRecord[]> {
    const acl: AclEntry[] = [{ kind: "group", principal: "gmail:workspace" }];
    const q = this.opts.since ? `&q=${encodeURIComponent(`after:${Math.floor(Date.parse(this.opts.since) / 1000)}`)}` : "";
    const ids = await paginateCursor(
      this.fetchImpl,
      (c) => `${API}/messages?maxResults=100${q}${c ? `&pageToken=${encodeURIComponent(c)}` : ""}`,
      this.headers(),
      (d) => ({ items: d.messages ?? [], nextCursor: d.nextPageToken ?? null }),
      { maxPages: this.opts.maxPages, onCapped: (p) => console.error(`⚠ gmail: maxPages (${p}) doldu — daha fazla mesaj olabilir.`) }
    );

    const out: SourceRecord[] = [];
    for (const m of ids) {
      const { data: full } = await getJson(this.fetchImpl, `${API}/messages/${m.id}?format=full`, this.headers());
      out.push(this.toRecord(full, acl));
    }
    return out;
  }

  private toRecord(msg: any, acl: AclEntry[]): SourceRecord {
    const id = String(msg.id);
    const p = msg.payload;
    const subject = headerVal(p, "Subject") || "(no subject)";
    const from = headerVal(p, "From");
    const to = headerVal(p, "To");
    const body = plainText(p).slice(0, 20000);
    const ms = Number(msg.internalDate);
    const capturedAt = Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
    return {
      sourceId: id,
      type: "document",
      tier: "working",
      title: subject.slice(0, 80),
      content: `From: ${from}\nTo: ${to}\n\n${body}`,
      uri: `https://mail.google.com/mail/u/0/#all/${id}`,
      capturedAt,
      acl,
      slug: `working/gmail/${id}`,
    };
  }
}
