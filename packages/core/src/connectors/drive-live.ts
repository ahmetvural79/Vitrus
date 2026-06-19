// src/connectors/drive-live.ts
// Google Drive CANLI connector — REST (OAuth Bearer access token). DocsConnector ile aynı şekil:
// slug `working/drive/<id>`, type document, ACL grup `drive:workspace`.
//
// pageToken pagination → http.paginateCursor (Slack ile aynı yardımcı). Google Doc'lar düz-metin
// EXPORT edilir (N+1); diğer dosyalarda metadata. Incremental: q=modifiedTime > '<iso>'.

import type { Connector, SourceRecord } from "./types.js";
import type { AclEntry } from "../core/types.js";
import { type HttpFetch, defaultFetch, paginateCursor } from "./http.js";

const API = "https://www.googleapis.com/drive/v3";
const GDOC = "application/vnd.google-apps.document";

export interface DriveLiveOpts {
  token: string; // OAuth access token (Bearer)
  since?: string; // ISO → yalnız bu tarihten sonra değişenler
  fetchImpl?: HttpFetch;
  maxPages?: number;
}

function personSlug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

export class DriveLiveConnector implements Connector {
  readonly name = "drive";
  readonly slugPrefix = "working/drive/";
  private readonly fetchImpl: HttpFetch;
  constructor(private readonly opts: DriveLiveOpts) {
    this.fetchImpl = opts.fetchImpl ?? defaultFetch;
  }
  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.opts.token}` };
  }

  async fetch(): Promise<SourceRecord[]> {
    const acl: AclEntry[] = [{ kind: "group", principal: "drive:workspace" }];
    const fields = encodeURIComponent("nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName))");
    const q = this.opts.since ? `&q=${encodeURIComponent(`modifiedTime > '${this.opts.since}'`)}` : "";
    const files = await paginateCursor(
      this.fetchImpl,
      (c) => `${API}/files?pageSize=100&fields=${fields}${q}${c ? `&pageToken=${encodeURIComponent(c)}` : ""}`,
      this.headers(),
      (d) => ({ items: d.files ?? [], nextCursor: d.nextPageToken ?? null }),
      { maxPages: this.opts.maxPages, onCapped: (p) => console.error(`⚠ drive: maxPages (${p}) doldu — daha fazla dosya olabilir.`) }
    );

    const out: SourceRecord[] = [];
    for (const f of files) out.push(await this.toRecord(f, acl));
    return out;
  }

  private async toRecord(f: any, acl: AclEntry[]): Promise<SourceRecord> {
    let body = "";
    if (f.mimeType === GDOC) {
      // Google Doc → düz metin export (başarısızsa metadata ile devam — fail-soft).
      try {
        const res = await this.fetchImpl(`${API}/files/${f.id}/export?mimeType=text/plain`, { headers: this.headers() });
        if (res.status >= 200 && res.status < 300) body = (await res.text()).slice(0, 20000);
      } catch {
        /* export edilemezse metadata yeter */
      }
    }
    const owner = f.owners?.[0]?.displayName ? `\n\nSahip: [[durable/people/${personSlug(String(f.owners[0].displayName))}]]` : "";
    return {
      sourceId: String(f.id),
      type: "document",
      tier: "working",
      title: String(f.name ?? f.id).slice(0, 80),
      content: `${body || `(${f.mimeType ?? "file"})`}${owner}`,
      uri: f.webViewLink ?? null,
      capturedAt: f.modifiedTime ?? null,
      acl,
      slug: `working/drive/${f.id}`,
    };
  }
}
