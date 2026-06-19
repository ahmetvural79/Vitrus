// src/connectors/github-live.ts
// GitHub CANLI connector — gerçek REST API (PAT / OAuth token). Fixture connector
// (github.ts) ile AYNI SourceRecord şeklini üretir (slug/type/ACL/sourceId) → indeks,
// auto-link ve prune davranışı birebir aynı; yalnız KAYNAK değişir (API vs dosya).
//
// HTTP dependency-injectable (http.ts) → eşleme mock fetch ile test edilir; gerçek
// token testi sonra. Incremental: `since` (ISO) → yalnız o tarihten sonra GÜNCELLENEN
// issue/PR'lar (GitHub issues API `since` = updated_since). Bu durumda ingest PRUNE
// ETMEMELİDİR (delta fetch — eskileri silmesin); CLI `--since` ile prune=false geçer.
//
// Eşleme fonksiyonları (githubAcl / githubItemToRecord) DIŞA AKTARILIR → webhook hattı
// (webhooks.ts) aynı slug/sourceId'yi üretir (tam-sync ile webhook deltası çakışmaz).

import type { Connector, SourceRecord } from "./types.js";
import type { AclEntry, NodeType } from "../core/types.js";
import { PUBLIC_PRINCIPAL } from "../core/types.js";
import { type HttpFetch, defaultFetch, getJson, paginate } from "./http.js";

const API = "https://api.github.com";

export interface GitHubLiveOpts {
  repo: string; // "owner/name"
  token: string; // PAT veya OAuth access token
  since?: string; // ISO — incremental (yalnız bu tarihten sonra güncellenenler)
  fetchImpl?: HttpFetch; // test injection (varsayılan global fetch)
  maxPages?: number; // güvenlik tavanı (varsayılan 10 × 100 = 1000 öğe)
}

/** GitHub issue/PR objesinin ihtiyaç duyduğumuz alanları (REST + webhook ortak). */
export interface GhItem {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  created_at: string;
  user: { login: string } | null;
}

/** Repo görünürlüğü → ACL (public → public; private → repo grubu, fail-closed). */
export function githubAcl(isPrivate: boolean, repo: string): AclEntry[] {
  return isPrivate
    ? [{ kind: "group", principal: `github:${repo}` }]
    : [{ kind: "public", principal: PUBLIC_PRINCIPAL }];
}

/** GitHub issue/PR → SourceRecord (tek kaynak: connector + webhook aynı slug/sourceId). */
export function githubItemToRecord(repo: string, it: GhItem, acl: AclEntry[], isPr: boolean): SourceRecord {
  const type: NodeType = isPr ? "document" : "note";
  const author = it.user?.login ?? "unknown";
  const body = it.body ?? "";
  const content = `${body}\n\nYazar: [[durable/people/${author}]] · ${repo}#${it.number}`;
  return {
    sourceId: `${repo}#${it.number}`,
    type,
    tier: "working",
    title: it.title,
    content,
    uri: it.html_url,
    capturedAt: it.created_at,
    acl,
    slug: `working/github/${repo}/${it.number}`,
  };
}

export class GitHubLiveConnector implements Connector {
  readonly name = "github";
  readonly slugPrefix = "working/github/";
  private readonly fetchImpl: HttpFetch;
  constructor(private readonly opts: GitHubLiveOpts) {
    this.fetchImpl = opts.fetchImpl ?? defaultFetch;
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.opts.token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "vitrus",
    };
  }

  async fetch(): Promise<SourceRecord[]> {
    const { repo } = this.opts;
    // 1) Repo görünürlüğü → ACL.
    const repoRes = await getJson(this.fetchImpl, `${API}/repos/${repo}`, this.headers());
    const acl = githubAcl(!!repoRes.data?.private, repo);

    // 2) Issues + PR'lar (issues endpoint ikisini de döndürür; PR'da pull_request alanı var).
    const sinceQ = this.opts.since ? `&since=${encodeURIComponent(this.opts.since)}` : "";
    const startUrl = `${API}/repos/${repo}/issues?state=all&per_page=100${sinceQ}`;
    const items = (await paginate(this.fetchImpl, startUrl, this.headers(), {
      maxPages: this.opts.maxPages,
      onCapped: (pages) =>
        // Sessiz kırpma YOK (CLAUDE.md invariantı) — uyar, veri uydurma.
        console.error(`⚠ github ${repo}: maxPages (${pages}) doldu — daha fazla issue/PR olabilir; --max-pages artır.`),
    })) as (GhItem & { pull_request?: unknown })[];

    return items.map((it) => githubItemToRecord(repo, it, acl, !!it.pull_request));
  }
}
