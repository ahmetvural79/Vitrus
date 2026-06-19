// src/connectors/jira-live.ts
// Jira CANLI connector — REST (Basic auth: email:api_token). DocsConnector ile aynı şekil:
// slug `working/jira/<KEY>`, type document, ACL grup `jira:workspace`.
//
// Jira OFFSET pagination (startAt + maxResults + total) → 5. pagination şekli. Açıklama (ADF)
// Atlassian Document Format (JSON) → recursive düz-metin flatten. Incremental: `since` → JQL.
// NOT: klasik /rest/api/3/search offset ile; yeni token-cursor uç noktası gelince extract değişir.

import type { Connector, SourceRecord } from "./types.js";
import type { AclEntry } from "../core/types.js";
import { type HttpFetch, defaultFetch, getJson } from "./http.js";

export interface JiraLiveOpts {
  site: string; // "yourco" → https://yourco.atlassian.net (veya tam URL)
  email: string;
  token: string; // API token (Basic auth)
  jql?: string; // ek filtre
  since?: string; // ISO → JQL updated >=
  fetchImpl?: HttpFetch;
  maxPages?: number;
}

/** ADF (Atlassian Document Format) → düz metin (recursive text toplama). */
function adfText(node: any): string {
  if (!node || typeof node !== "object") return "";
  if (typeof node.text === "string") return node.text;
  return Array.isArray(node.content) ? node.content.map(adfText).join(" ").replace(/\s+/g, " ").trim() : "";
}
function descText(desc: any): string {
  return !desc ? "" : typeof desc === "string" ? desc : adfText(desc);
}
function baseUrl(site: string): string {
  return site.startsWith("http") ? site.replace(/\/+$/, "") : `https://${site}.atlassian.net`;
}
/** ISO → JQL tarihi "YYYY-MM-DD HH:mm" (UTC). */
function jiraDate(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
function personSlug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

export class JiraLiveConnector implements Connector {
  readonly name = "jira";
  readonly slugPrefix = "working/jira/";
  private readonly fetchImpl: HttpFetch;
  private readonly base: string;
  constructor(private readonly opts: JiraLiveOpts) {
    this.fetchImpl = opts.fetchImpl ?? defaultFetch;
    this.base = baseUrl(opts.site);
  }

  private headers(): Record<string, string> {
    const basic = Buffer.from(`${this.opts.email}:${this.opts.token}`).toString("base64");
    return { authorization: `Basic ${basic}`, accept: "application/json" };
  }
  private jql(): string {
    const parts: string[] = [];
    if (this.opts.jql) parts.push(`(${this.opts.jql})`);
    if (this.opts.since) parts.push(`updated >= "${jiraDate(this.opts.since)}"`);
    return `${parts.length ? parts.join(" AND ") + " " : ""}order by updated DESC`;
  }

  async fetch(): Promise<SourceRecord[]> {
    const acl: AclEntry[] = [{ kind: "group", principal: "jira:workspace" }];
    const maxPages = this.opts.maxPages ?? 10;
    const pageSize = 100;
    const jql = encodeURIComponent(this.jql());
    const fields = "summary,description,created,updated,creator";
    const out: SourceRecord[] = [];
    let startAt = 0;
    let pages = 0;
    let total = Number.POSITIVE_INFINITY;

    while (pages < maxPages) {
      const url = `${this.base}/rest/api/3/search?jql=${jql}&startAt=${startAt}&maxResults=${pageSize}&fields=${fields}`;
      const { data } = await getJson(this.fetchImpl, url, this.headers());
      const batch = data.issues ?? [];
      total = typeof data.total === "number" ? data.total : startAt + batch.length;
      for (const it of batch) out.push(this.toRecord(it, acl));
      startAt += batch.length; // gerçek dönen sayı kadar ilerle (offset)
      pages++;
      if (batch.length === 0 || startAt >= total) break;
    }
    if (startAt < total) console.error(`⚠ jira: maxPages doldu (${out.length}/${total}) — --max-pages artır.`);
    return out;
  }

  private toRecord(it: any, acl: AclEntry[]): SourceRecord {
    const key = String(it.key);
    const f = it.fields ?? {};
    const author = f.creator?.displayName ? `\n\nYazar: [[durable/people/${personSlug(f.creator.displayName)}]]` : "";
    return {
      sourceId: key,
      type: "document",
      tier: "working",
      title: String(f.summary ?? key).slice(0, 80),
      content: `${descText(f.description)}${author}`,
      uri: `${this.base}/browse/${key}`,
      capturedAt: f.created ?? null,
      acl,
      slug: `working/jira/${key}`,
    };
  }
}
