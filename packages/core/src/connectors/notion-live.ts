// src/connectors/notion-live.ts
// Notion CANLI connector — gerçek API (integration token). DocsConnector (docs.ts) ile
// AYNI şekil: slug `working/notion/<id>`, type document, ACL grup `notion:workspace`.
// → fixture import ile aynı namespace (prune/dedup tutarlı).
//
// Notion pagination CURSOR'dur ama POST gövdesinde (start_cursor) → http.postJson + manuel döngü
// (GitHub Link / Slack GET-cursor'dan farklı 3. şekil; injectable infra genel). Notion hata
// durumunda doğru HTTP status döndürür → postJson fail-loud yakalar.
//
// Incremental: `since` (ISO) — sonuçlar last_edited_time'a göre azalan sıralı; eskiye geçince DUR.

import type { Connector, SourceRecord } from "./types.js";
import type { AclEntry } from "../core/types.js";
import { type HttpFetch, defaultFetch, postJson } from "./http.js";

const API = "https://api.notion.com/v1";

export interface NotionLiveOpts {
  token: string; // Notion internal integration token (secret_...)
  since?: string; // ISO — yalnız bu tarihten sonra düzenlenenler
  fetchImpl?: HttpFetch;
  maxPages?: number;
}

/** Notion property değerinden düz metin (title veya rich_text dizisi). */
function propText(prop: any): string {
  const arr = prop?.title ?? prop?.rich_text;
  return Array.isArray(arr) ? arr.map((t: any) => t?.plain_text ?? "").join("") : "";
}
function pageTitle(page: any): string {
  const props = page?.properties ?? {};
  for (const k of Object.keys(props)) {
    if (props[k]?.type === "title") {
      const t = propText(props[k]);
      if (t) return t;
    }
  }
  return "Untitled";
}
function pageBody(page: any): string {
  const props = page?.properties ?? {};
  const lines: string[] = [];
  for (const k of Object.keys(props)) {
    const t = propText(props[k]);
    if (t) lines.push(`${k}: ${t}`);
  }
  return lines.join("\n");
}

export class NotionLiveConnector implements Connector {
  readonly name = "notion";
  readonly slugPrefix = "working/notion/";
  private readonly fetchImpl: HttpFetch;
  constructor(private readonly opts: NotionLiveOpts) {
    this.fetchImpl = opts.fetchImpl ?? defaultFetch;
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.opts.token}`, "notion-version": "2022-06-28" };
  }

  async fetch(): Promise<SourceRecord[]> {
    const since = this.opts.since ? Date.parse(this.opts.since) : null;
    const maxPages = this.opts.maxPages ?? 10;
    const acl: AclEntry[] = [{ kind: "group", principal: "notion:workspace" }];
    const out: SourceRecord[] = [];
    let cursor: string | undefined;
    let pages = 0;
    let stop = false;

    while (!stop && pages < maxPages) {
      const { data } = await postJson(this.fetchImpl, `${API}/search`, this.headers(), {
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
        filter: { property: "object", value: "page" },
        sort: { direction: "descending", timestamp: "last_edited_time" },
      });
      for (const page of data.results ?? []) {
        const edited = page.last_edited_time ? Date.parse(page.last_edited_time) : null;
        if (since !== null && edited !== null && edited < since) {
          stop = true; // azalan sıralı → buradan sonrası hep eski
          break;
        }
        out.push(this.toRecord(page, acl));
      }
      pages++;
      if (stop) break;
      cursor = data.has_more ? data.next_cursor : undefined;
      if (!cursor) break;
    }
    if (cursor && !stop) console.error(`⚠ notion: maxPages (${pages}) doldu — daha fazla sayfa olabilir.`);
    return out;
  }

  private toRecord(page: any, acl: AclEntry[]): SourceRecord {
    const id = String(page.id);
    return {
      sourceId: id,
      type: "document",
      tier: "working",
      title: pageTitle(page).slice(0, 80) || "Untitled",
      content: pageBody(page),
      uri: page.url ?? null,
      capturedAt: page.last_edited_time ?? page.created_time ?? null,
      acl,
      slug: `working/notion/${id}`,
    };
  }
}
