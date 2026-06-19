// src/connectors/linear-live.ts
// Linear CANLI connector — GraphQL API (API key). DocsConnector ile AYNI şekil:
// slug `working/linear/<identifier>` (ör. ENG-123), type document, ACL grup `linear:workspace`.
//
// Linear GRAPHQL'dir (POST + query) → http.postJson + cursor (pageInfo.endCursor) ile döngü.
// 4. pagination/protokol şekli (REST-Link / GET-cursor / POST-cursor / GraphQL-cursor) → infra genel.
// GraphQL hatası HTTP 200 + {errors} ile gelebilir → manuel kontrol (Slack ok:false gibi).
//
// Incremental: `since` (ISO) → filter { updatedAt: { gt: $since } }.

import type { Connector, SourceRecord } from "./types.js";
import type { AclEntry } from "../core/types.js";
import { type HttpFetch, defaultFetch, postJson } from "./http.js";

const API = "https://api.linear.app/graphql";

export interface LinearLiveOpts {
  token: string; // Linear API key (Authorization: <key>, "Bearer" YOK)
  since?: string; // ISO — yalnız bu tarihten sonra güncellenenler
  fetchImpl?: HttpFetch;
  maxPages?: number;
}

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  createdAt: string;
  creator: { name: string } | null;
}

/** Yazar adını kişi-slug'ına çevir (kebab; people düğümleriyle eşleşsin). */
function authorSlug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

export class LinearLiveConnector implements Connector {
  readonly name = "linear";
  readonly slugPrefix = "working/linear/";
  private readonly fetchImpl: HttpFetch;
  constructor(private readonly opts: LinearLiveOpts) {
    this.fetchImpl = opts.fetchImpl ?? defaultFetch;
  }

  private headers(): Record<string, string> {
    return { authorization: this.opts.token }; // Linear: ham API key
  }

  async fetch(): Promise<SourceRecord[]> {
    const acl: AclEntry[] = [{ kind: "group", principal: "linear:workspace" }];
    const maxPages = this.opts.maxPages ?? 10;
    const filterArg = this.opts.since ? ", filter: { updatedAt: { gt: $since } }" : "";
    const query = `query Issues($after: String, $since: DateTimeOrDuration) {
      issues(first: 100, after: $after${filterArg}) {
        nodes { id identifier title description url createdAt updatedAt creator { name } }
        pageInfo { hasNextPage endCursor }
      }
    }`;

    const out: SourceRecord[] = [];
    let after: string | null = null;
    let pages = 0;
    let hasNext = false;
    while (pages < maxPages) {
      const variables: Record<string, unknown> = { after };
      if (this.opts.since) variables.since = this.opts.since;
      const { data } = await postJson(this.fetchImpl, API, this.headers(), { query, variables });
      if (data.errors) throw new Error(`linear graphql: ${JSON.stringify(data.errors).slice(0, 200)}`);
      const conn = data.data?.issues;
      for (const n of (conn?.nodes ?? []) as LinearIssue[]) out.push(this.toRecord(n, acl));
      pages++;
      hasNext = !!conn?.pageInfo?.hasNextPage;
      if (hasNext) after = conn.pageInfo.endCursor;
      else break;
    }
    if (hasNext) console.error(`⚠ linear: maxPages (${pages}) doldu — daha fazla issue olabilir.`);
    return out;
  }

  private toRecord(n: LinearIssue, acl: AclEntry[]): SourceRecord {
    const id = String(n.identifier ?? n.id);
    const author = n.creator?.name ? `\n\nYazar: [[durable/people/${authorSlug(n.creator.name)}]]` : "";
    return {
      sourceId: id,
      type: "document",
      tier: "working",
      title: String(n.title ?? id).slice(0, 80),
      content: `${n.description ?? ""}${author}`,
      uri: n.url ?? null,
      capturedAt: n.createdAt ?? null,
      acl,
      slug: `working/linear/${id}`,
    };
  }
}
