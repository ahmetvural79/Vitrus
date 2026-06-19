// src/connectors/http.ts
// Canlı connector'lar için minimal HTTP katmanı — DEPENDENCY-INJECTABLE.
// Eşleme mantığı (API JSON → SourceRecord) mock fetch ile deterministik test edilir;
// gerçek token testi sonra. "Fail loud": non-2xx → sessiz boş değil, açık hata
// (OpenAIEmbedder ile aynı duruş). Pagination: RFC 5988 Link header (rel="next").

/** fetch Response'un ihtiyaç duyduğumuz minimal yüzeyi (global fetch bunu sağlar). */
export interface HttpResponse {
  status: number;
  json(): Promise<any>;
  text(): Promise<string>;
  headers: { get(name: string): string | null };
}

export type HttpFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<HttpResponse>;

/** Varsayılan: global fetch (Bun / Node 20+). Tipi daraltır. */
export const defaultFetch: HttpFetch = (url, init) =>
  fetch(url, init as RequestInit) as unknown as Promise<HttpResponse>;

/** Link header'dan rel="next" URL'sini çıkarır (yoksa null). */
export function nextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

/** GET + JSON; non-2xx → açık hata (status + gövde snippet). 401/403 → auth ipucu. */
export async function getJson(
  fetchImpl: HttpFetch,
  url: string,
  headers: Record<string, string>
): Promise<{ data: any; link: string | null; status: number }> {
  const res = await fetchImpl(url, { headers });
  if (res.status < 200 || res.status >= 300) {
    const body = await res.text().catch(() => "");
    const hint = res.status === 401 || res.status === 403 ? " (auth: token/scope eksik veya geçersiz)" : "";
    throw new Error(`HTTP ${res.status} for ${url}${hint}${body ? ` — ${body.slice(0, 200)}` : ""}`);
  }
  return { data: await res.json(), link: res.headers.get("link"), status: res.status };
}

/** POST + JSON gövde; non-2xx → açık hata (Notion/Linear GraphQL gibi POST API'ler için). */
export async function postJson(
  fetchImpl: HttpFetch,
  url: string,
  headers: Record<string, string>,
  body: unknown
): Promise<{ data: any; status: number }> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (res.status < 200 || res.status >= 300) {
    const text = await res.text().catch(() => "");
    const hint = res.status === 401 || res.status === 403 ? " (auth: token/scope eksik veya geçersiz)" : "";
    throw new Error(`HTTP ${res.status} for ${url}${hint}${text ? ` — ${text.slice(0, 200)}` : ""}`);
  }
  return { data: await res.json(), status: res.status };
}

/**
 * Link-header pagination ile tüm sayfaları toplar. maxPages güvenlik tavanı;
 * tavana takılırsa SESSİZ KIRPMA YOK → onCapped(pages) ile çağıran uyarır.
 */
export async function paginate(
  fetchImpl: HttpFetch,
  startUrl: string,
  headers: Record<string, string>,
  opts: { maxPages?: number; onCapped?: (pages: number) => void } = {}
): Promise<any[]> {
  const maxPages = opts.maxPages ?? 10;
  let url: string | null = startUrl;
  const out: any[] = [];
  let pages = 0;
  while (url && pages < maxPages) {
    const { data, link } = await getJson(fetchImpl, url, headers);
    if (Array.isArray(data)) out.push(...data);
    else out.push(data);
    url = nextLink(link);
    pages++;
  }
  if (url && opts.onCapped) opts.onCapped(pages); // hâlâ sonraki sayfa varken durduk
  return out;
}

/**
 * Cursor-tabanlı pagination (Slack/Notion gibi — sonraki imleç JSON GÖVDESİNDE,
 * Link header'da DEĞİL). buildUrl(cursor): imleçle URL kur. extract(data):
 * {items, nextCursor} (mantıksal hata varsa burada throw edilir — Slack ok:false 200 döner).
 * Tavana takılırsa SESSİZ KIRPMA YOK → onCapped(pages).
 */
export async function paginateCursor(
  fetchImpl: HttpFetch,
  buildUrl: (cursor: string | null) => string,
  headers: Record<string, string>,
  extract: (data: any) => { items: any[]; nextCursor: string | null },
  opts: { maxPages?: number; onCapped?: (pages: number) => void } = {}
): Promise<any[]> {
  const maxPages = opts.maxPages ?? 10;
  let cursor: string | null = null;
  const out: any[] = [];
  let pages = 0;
  do {
    const { data } = await getJson(fetchImpl, buildUrl(cursor), headers);
    const { items, nextCursor } = extract(data);
    out.push(...items);
    cursor = nextCursor && nextCursor.length > 0 ? nextCursor : null;
    pages++;
  } while (cursor && pages < maxPages);
  if (cursor && opts.onCapped) opts.onCapped(pages);
  return out;
}
