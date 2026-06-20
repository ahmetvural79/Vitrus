// M1 Faz A: generic REST connector — deterministik (enjekte fetch).
import { test } from "node:test";
import assert from "node:assert/strict";
import { RestConnector, type RestFetch } from "../src/connectors/rest.js";
import { ingest } from "../src/connectors/ingest.js";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";

interface CapturedReq {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}
function mockFetch(body: unknown, capture?: (r: CapturedReq) => void, ok = true, status = 200): RestFetch {
  return async (url, init) => {
    capture?.({ url, method: init.method, headers: init.headers, body: init.body });
    return {
      ok,
      status,
      async text() {
        return typeof body === "string" ? body : JSON.stringify(body);
      },
      async json() {
        return body;
      },
    };
  };
}
const NOW = "2026-06-20T00:00:00.000Z";

test("GET: params + bearer auth + itemsPath/field eşlemesi", async () => {
  let req: CapturedReq | undefined;
  const fetchImpl = mockFetch(
    { data: { results: [{ id: "u1", name: "Alice", bio: "eng lead", link: "https://x/u1" }, { id: "u2", name: "Bob", bio: "pm" }] } },
    (r) => {
      req = r;
    }
  );
  const conn = new RestConnector(
    {
      url: "https://api.example.com/users",
      params: { page: "1" },
      auth: { type: "bearer", token: "secret" },
      itemsPath: "data.results",
      idField: "id",
      titleField: "name",
      contentField: "bio",
      uriField: "link",
      name: "users-api",
      type: "person",
    },
    { now: NOW, fetchImpl }
  );
  const recs = await conn.fetch();
  assert.equal(req!.method, "GET");
  assert.match(req!.url, /page=1/);
  assert.equal(req!.headers.authorization, "Bearer secret");
  assert.equal(req!.body, undefined, "GET'te body yok");
  assert.equal(recs.length, 2);
  assert.equal(recs[0].sourceId, "u1");
  assert.equal(recs[0].title, "Alice");
  assert.equal(recs[0].content, "eng lead");
  assert.equal(recs[0].uri, "https://x/u1");
  assert.equal(recs[0].type, "person");
  assert.equal(recs[0].slug, "working/api/u1");
  assert.equal(conn.name, "users-api");
});

test("POST: body + content-type; tek nesne → 1 kayıt; özel auth header", async () => {
  let req: CapturedReq | undefined;
  const fetchImpl = mockFetch({ id: "x", title: "T", text: "C" }, (r) => {
    req = r;
  });
  const conn = new RestConnector(
    {
      url: "https://api/x",
      method: "POST",
      body: { q: "hi" },
      auth: { type: "header", header: "x-api-key", token: "k" },
      idField: "id",
      titleField: "title",
      contentField: "text",
    },
    { now: NOW, fetchImpl }
  );
  const recs = await conn.fetch();
  assert.equal(req!.method, "POST");
  assert.equal(req!.headers["content-type"], "application/json");
  assert.equal(req!.headers["x-api-key"], "k");
  assert.equal(JSON.parse(req!.body!).q, "hi");
  assert.equal(recs.length, 1, "tek nesne yanıtı → 1 kayıt");
  assert.equal(recs[0].sourceId, "x");
});

test("HTTP hata → fail-loud", async () => {
  const conn = new RestConnector({ url: "https://api/x" }, { now: NOW, fetchImpl: mockFetch("nope", undefined, false, 503) });
  await assert.rejects(() => conn.fetch(), /HTTP 503/);
});

test("ACL: owner→private, yoksa public; slug güvenli", async () => {
  const fetchImpl = mockFetch([{ id: "A B/c", v: 1 }]);
  const pub = await new RestConnector({ url: "https://a", idField: "id" }, { now: NOW, fetchImpl }).fetch();
  assert.equal(pub[0].acl[0].kind, "public");
  assert.equal(pub[0].slug, "working/api/a-b-c", "boşluk/slash → -");
  const priv = await new RestConnector({ url: "https://a", idField: "id" }, { now: NOW, owner: "alice", fetchImpl }).fetch();
  assert.equal(priv[0].acl[0].principal, "alice");
});

test("round-trip: ingest rest → search bulur", async () => {
  const e = new PgliteEngine({ embedder: new HashingEmbedder() });
  await e.init();
  try {
    const fetchImpl = mockFetch({ items: [{ id: "svc-1", name: "payments gateway", desc: "stripe billing service" }] });
    const conn = new RestConnector(
      { url: "https://a", itemsPath: "items", idField: "id", titleField: "name", contentField: "desc" },
      { now: NOW, fetchImpl }
    );
    await ingest(e, conn);
    const hits = await e.search("payments stripe billing", { limit: 5 });
    assert.ok(hits.some((h) => h.node.slug === "working/api/svc-1"));
  } finally {
    await e.close();
  }
});
