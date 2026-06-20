// src/api-hub/execute.ts
// Doğrula → (geçerse) ÇALIŞTIR. verdict.ok=false → çağrı YOK (anti-halüsinasyon kapısı çalıştırmadan önce).
// Ham yanıtı döndürür (ajan için); ingestion DEĞİL (o RestConnector'ın işi). Enjekte edilebilir fetch.

import type { RestFetch } from "../connectors/rest.js";
import type { ApiEndpointCard, ApiCallVerdict } from "./types.js";
import { verifyApiCall } from "./verify-call.js";

export interface ApiCallResult {
  verdict: ApiCallVerdict;
  ok: boolean;
  url?: string;
  status?: number;
  body?: unknown;
}

export interface CallOpts {
  token?: string;
  baseUrl?: string; // card.baseUrl'i ezer
  fetchImpl?: RestFetch;
  dryRun?: boolean; // doğrula + URL kur ama çağırma
  allowDeprecated?: boolean;
}

export async function callApi(
  card: ApiEndpointCard,
  args: Record<string, unknown> = {},
  opts: CallOpts = {}
): Promise<ApiCallResult> {
  const verdict = verifyApiCall(card, args);
  if (!verdict.ok || (verdict.status === "deprecated" && !opts.allowDeprecated)) return { verdict, ok: false };

  const base = (opts.baseUrl ?? card.baseUrl ?? "").replace(/\/+$/, "");
  if (!base) return { verdict: { ...verdict, ok: false, issues: [...verdict.issues, "no baseUrl (pass baseUrl)"] }, ok: false };

  const byName = new Map(card.parameters.map((p) => [p.name, p]));
  const path = card.path.replace(/\{([^}]+)\}/g, (_m, k) => encodeURIComponent(String(args[k] ?? `{${k}}`)));
  const url = new URL(base + path);
  const headers: Record<string, string> = {};
  const bodyObj: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    const p = byName.get(k);
    if (p?.in === "path") continue; // URL'de
    else if (p?.in === "header") headers[k] = String(v);
    else if (p?.in === "query") url.searchParams.set(k, String(v));
    else if (k === "body" && v && typeof v === "object") Object.assign(bodyObj, v as object);
    else bodyObj[k] = v; // requestBody alanı
  }
  if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
  const method = card.method.toUpperCase();
  const sendBody = method !== "GET" && method !== "DELETE" && Object.keys(bodyObj).length > 0;
  if (sendBody && !headers["content-type"]) headers["content-type"] = "application/json";

  if (opts.dryRun) return { verdict, ok: true, url: url.toString() };

  const fetchImpl = opts.fetchImpl ?? ((globalThis as { fetch?: unknown }).fetch as RestFetch | undefined);
  if (!fetchImpl) throw new Error("callApi: no fetch available (pass fetchImpl)");
  const res = await fetchImpl(url.toString(), { method, headers, ...(sendBody ? { body: JSON.stringify(bodyObj) } : {}) });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = await res.text().catch(() => null);
  }
  return { verdict, ok: res.ok, status: res.status, body, url: url.toString() };
}
