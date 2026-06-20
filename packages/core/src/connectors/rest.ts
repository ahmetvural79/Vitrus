// src/connectors/rest.ts
// M1 Faz A — Generic REST connector (Image #1'in motoru): herhangi bir REST endpoint'i
// yapılandırılabilir Method/URL/Headers/Body/Params ile çağırır → JSON yanıtını SourceRecord'lara
// eşler → beyne alır. Servise-özel canlı connector'lardan farkı: KULLANICI tanımlı, şemasız.
// Deterministik test: enjekte edilebilir fetch (FetchLike deseni) + dışarıdan `now`.

import { createHash } from "node:crypto";
import type { Connector, SourceRecord } from "./types.js";
import { PUBLIC_PRINCIPAL, type AclEntry, type NodeType } from "../core/types.js";

/** Esnek fetch (body GET'te opsiyonel — embedder FetchLike'ın REST varyantı). */
export type RestFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string }
) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;

export interface RestConfig {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; // Image #1 metod dropdown'u
  url: string; // Image #1 API URL
  headers?: Record<string, string>; // Image #1 Headers sekmesi
  params?: Record<string, string>; // Image #1 Params (Key/Value) → query string
  body?: unknown; // Image #1 Body sekmesi (JSON gövde — GET/DELETE'te yok sayılır)
  auth?: { type: "bearer" | "header"; token: string; header?: string }; // header: özel başlık adı
  // --- yanıt → kayıt eşlemesi ---
  itemsPath?: string; // dizi öğelerine JSON yolu (ör. "data.results"); boş → yanıt dizi/tek nesne
  idField?: string; // öğe alanı → sourceId (idempotent senkron anahtarı)
  titleField?: string; // öğe alanı → başlık
  contentField?: string; // öğe alanı → içerik (yoksa öğe JSON'u)
  uriField?: string; // öğe alanı → glass-box geri-link
  // --- namespace / tip ---
  name?: string; // provenance connector adı (varsayılan "rest")
  slugPrefix?: string; // varsayılan "working/api/"
  type?: NodeType; // varsayılan "document"
}

export interface RestOpts {
  /** ISO yakalama zamanı — deterministik (core'da Date.now yok). */
  now: string;
  owner?: string; // verilirse private; yoksa public
  scope?: string;
  fetchImpl?: RestFetch; // enjekte edilebilir (test); varsayılan global fetch
}

function sha8(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 8);
}
function slugSafe(s: string): string {
  return s.replace(/[^a-zA-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "item";
}
function aclFor(owner?: string): AclEntry[] {
  return owner ? [{ kind: "user", principal: owner }] : [{ kind: "public", principal: PUBLIC_PRINCIPAL }];
}

export class RestConnector implements Connector {
  readonly name: string;
  readonly slugPrefix: string;
  private fetchImpl: RestFetch;

  constructor(
    private config: RestConfig,
    private opts: RestOpts
  ) {
    if (!config?.url) throw new Error("RestConnector: config.url required");
    this.name = config.name ?? "rest";
    this.slugPrefix = config.slugPrefix ?? "working/api/";
    const globalFetch = (globalThis as { fetch?: unknown }).fetch as RestFetch | undefined;
    const fetchImpl = opts.fetchImpl ?? globalFetch;
    if (!fetchImpl) throw new Error("RestConnector: no fetch available (pass fetchImpl)");
    this.fetchImpl = fetchImpl;
  }

  async fetch(): Promise<SourceRecord[]> {
    const url = new URL(this.config.url);
    for (const [k, v] of Object.entries(this.config.params ?? {})) url.searchParams.set(k, v);

    const headers: Record<string, string> = { ...(this.config.headers ?? {}) };
    const auth = this.config.auth;
    if (auth?.type === "bearer") headers["authorization"] = `Bearer ${auth.token}`;
    else if (auth?.type === "header" && auth.header) headers[auth.header] = auth.token;

    const method = this.config.method ?? "GET";
    const sendBody = method !== "GET" && method !== "DELETE" && this.config.body !== undefined;
    if (sendBody && !headers["content-type"]) headers["content-type"] = "application/json";

    const res = await this.fetchImpl(url.toString(), {
      method,
      headers,
      ...(sendBody ? { body: JSON.stringify(this.config.body) } : {}),
    });
    if (!res.ok) throw new Error(`RestConnector(${this.name}): HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`);

    const items = this.extractItems(await res.json());
    return items.map((item, i) => this.toRecord(item, i));
  }

  /** itemsPath ile diziyi bul; yanıt zaten dizi/tek nesne ise onu kullan. */
  private extractItems(json: unknown): unknown[] {
    let node: unknown = json;
    if (this.config.itemsPath) {
      for (const key of this.config.itemsPath.split(".")) {
        node = node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined;
      }
    }
    if (Array.isArray(node)) return node;
    if (node && typeof node === "object") return [node];
    return [];
  }

  private toRecord(item: unknown, i: number): SourceRecord {
    const obj = item && typeof item === "object" ? (item as Record<string, unknown>) : { value: item };
    // Alan seçici: nokta-yolu destekler (ör. "properties.email" → obj.properties.email — HubSpot/Teams).
    const pick = (field?: string): string | undefined => {
      if (!field) return undefined;
      let v: unknown = obj;
      for (const k of field.split(".")) {
        if (v == null || typeof v !== "object") return undefined;
        v = (v as Record<string, unknown>)[k];
      }
      return v == null ? undefined : String(v);
    };
    const id = pick(this.config.idField) ?? sha8(JSON.stringify(item) + i);
    const content = pick(this.config.contentField) ?? JSON.stringify(obj, null, 2);
    return {
      sourceId: id,
      type: this.config.type ?? "document",
      tier: "working",
      title: (pick(this.config.titleField) ?? `${this.name} ${id}`).slice(0, 120),
      content,
      uri: pick(this.config.uriField) ?? null,
      capturedAt: this.opts.now,
      acl: aclFor(this.opts.owner),
      slug: `${this.slugPrefix}${slugSafe(id)}`,
      scope: this.opts.scope,
    };
  }
}
