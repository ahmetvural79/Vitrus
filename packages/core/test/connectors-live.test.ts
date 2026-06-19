import { test } from "node:test";
import assert from "node:assert/strict";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import { ingest } from "../src/connectors/ingest.js";
import type { Connector, SourceRecord } from "../src/connectors/types.js";
import { GitHubLiveConnector } from "../src/connectors/github-live.js";
import { SlackLiveConnector } from "../src/connectors/slack-live.js";
import { NotionLiveConnector } from "../src/connectors/notion-live.js";
import { LinearLiveConnector } from "../src/connectors/linear-live.js";
import { JiraLiveConnector } from "../src/connectors/jira-live.js";
import { DriveLiveConnector } from "../src/connectors/drive-live.js";
import { GmailLiveConnector } from "../src/connectors/gmail-live.js";
import { getJson, paginate, nextLink, type HttpFetch, type HttpResponse } from "../src/connectors/http.js";
import { PUBLIC_PRINCIPAL } from "../src/core/types.js";

// Canlı connector altyapısı — HTTP dependency-injection ile mock'lanır (gerçek token testi sonra).

function resp(body: unknown, opts: { status?: number; link?: string | null } = {}): HttpResponse {
  return {
    status: opts.status ?? 200,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    headers: { get: (n: string) => (n.toLowerCase() === "link" ? (opts.link ?? null) : null) },
  };
}

async function freshEngine(): Promise<PgliteEngine> {
  const e = new PgliteEngine({ embedder: new HashingEmbedder() });
  await e.init();
  return e;
}

test("http nextLink: Link header'dan rel=next çıkarır", () => {
  assert.equal(nextLink('<https://api/x?page=2>; rel="next", <https://api/x?page=9>; rel="last"'), "https://api/x?page=2");
  assert.equal(nextLink(null), null);
  assert.equal(nextLink('<https://api/x?page=9>; rel="last"'), null);
});

test("http getJson: non-2xx → açık hata (fail loud), 403 → auth ipucu", async () => {
  const fetchImpl: HttpFetch = async () => resp("forbidden", { status: 403 });
  await assert.rejects(() => getJson(fetchImpl, "https://api/x", {}), /HTTP 403.*auth/);
});

test("http paginate: maxPages tavanı → onCapped çağrılır (sessiz kırpma YOK)", async () => {
  // Her sayfa sonsuza dek bir 'next' döndürür → tavan devreye girmeli.
  const fetchImpl: HttpFetch = async () => resp([{ x: 1 }], { link: '<https://api/next>; rel="next"' });
  let capped = false;
  const out = await paginate(fetchImpl, "https://api/start", {}, { maxPages: 3, onCapped: () => (capped = true) });
  assert.equal(capped, true, "tavana takılınca onCapped çağrılmalı");
  assert.equal(out.length, 3, "3 sayfa toplanmalı");
});

test("github-live: issue→note, PR→document; slug/sourceId/author wikilink; public ACL", async () => {
  const fetchImpl: HttpFetch = async (url) => {
    if (url.endsWith("/repos/o/r")) return resp({ private: false });
    if (url.includes("/repos/o/r/issues")) {
      return resp([
        { number: 1, title: "Bug", body: "broken gateway", html_url: "https://gh/1", created_at: "2026-01-01T00:00:00Z", user: { login: "alice" } },
        { number: 2, title: "Add cache", body: "do it", html_url: "https://gh/2", created_at: "2026-01-02T00:00:00Z", user: { login: "bob" }, pull_request: { url: "x" } },
      ]);
    }
    throw new Error("unexpected url " + url);
  };
  const conn = new GitHubLiveConnector({ repo: "o/r", token: "t", fetchImpl });
  const recs = await conn.fetch();
  assert.equal(recs.length, 2);
  const [issue, pr] = recs;
  assert.equal(issue.type, "note");
  assert.equal(pr.type, "document"); // pull_request alanı → PR
  assert.equal(issue.slug, "working/github/o/r/1");
  assert.equal(issue.sourceId, "o/r#1");
  assert.equal(issue.uri, "https://gh/1");
  assert.equal(issue.capturedAt, "2026-01-01T00:00:00Z");
  assert.match(issue.content, /\[\[durable\/people\/alice\]\]/);
  assert.deepEqual(issue.acl, [{ kind: "public", principal: PUBLIC_PRINCIPAL }]);
});

test("github-live: private repo → grup ACL; pagination ile çok sayfa toplanır", async () => {
  const fetchImpl: HttpFetch = async (url) => {
    if (url.endsWith("/repos/o/r")) return resp({ private: true });
    if (url.includes("p2")) return resp([{ number: 3, title: "p2", body: "", html_url: "u3", created_at: "2026-01-03T00:00:00Z", user: { login: "c" } }]);
    if (url.includes("/issues")) {
      return resp(
        [
          { number: 1, title: "a", body: "", html_url: "u1", created_at: "2026-01-01T00:00:00Z", user: { login: "alice" } },
          { number: 2, title: "b", body: "", html_url: "u2", created_at: "2026-01-02T00:00:00Z", user: { login: "bob" } },
        ],
        { link: "<https://api.github.com/p2>; rel=\"next\"" }
      );
    }
    throw new Error("unexpected url " + url);
  };
  const conn = new GitHubLiveConnector({ repo: "o/r", token: "t", fetchImpl });
  const recs = await conn.fetch();
  assert.equal(recs.length, 3, "2 + 1 sayfa toplanmalı");
  assert.deepEqual(recs[0].acl, [{ kind: "group", principal: "github:o/r" }]);
});

test("slack-live: cursor pagination + @mention auto-link + grup ACL; users haritası", async () => {
  const usersPage1 = { ok: true, members: [{ id: "U_ALICE", name: "alice" }], response_metadata: { next_cursor: "C2" } };
  const usersPage2 = { ok: true, members: [{ id: "U_BOB", name: "bob" }], response_metadata: { next_cursor: "" } };
  const history = {
    ok: true,
    messages: [
      { ts: "1700000000.000100", user: "U_ALICE", text: "hey <@U_BOB> deploy?" },
      { ts: "1700000100.000200", user: "U_BOB", text: "done" },
    ],
    response_metadata: { next_cursor: "" },
  };
  const fetchImpl: HttpFetch = async (url) => {
    if (url.includes("users.list") && url.includes("cursor=C2")) return resp(usersPage2);
    if (url.includes("users.list")) return resp(usersPage1);
    if (url.includes("conversations.history")) return resp(history);
    throw new Error("unexpected url " + url);
  };
  const conn = new SlackLiveConnector({ channel: "C123", channelName: "platform", token: "t", fetchImpl });
  const recs = await conn.fetch();
  assert.equal(recs.length, 2, "2 thread (ayrı ts) kaydı");
  const first = recs.find((r) => r.sourceId === "C123/1700000000.000100")!;
  assert.equal(first.slug, "working/slack/platform/1700000000-000100");
  assert.match(first.content, /\[\[durable\/people\/bob\]\]/, "<@U_BOB> → bob auto-link");
  assert.match(first.content, /alice:/, "kullanıcı adı çözülmeli");
  assert.deepEqual(first.acl, [{ kind: "group", principal: "slack:platform" }]);
});

test("slack-live: ok:false → açık hata (fail loud)", async () => {
  const fetchImpl: HttpFetch = async (url) =>
    url.includes("users.list") ? resp({ ok: true, members: [], response_metadata: { next_cursor: "" } }) : resp({ ok: false, error: "channel_not_found" });
  const conn = new SlackLiveConnector({ channel: "CXXX", token: "t", fetchImpl });
  await assert.rejects(() => conn.fetch(), /conversations\.history: channel_not_found/);
});

// --- Notion (POST + body-cursor pagination) ---

test("notion-live: search → document; title/body properties; grup ACL; cursor pagination", async () => {
  const page1 = {
    results: [
      {
        id: "p1",
        url: "https://notion/p1",
        last_edited_time: "2026-06-10T00:00:00Z",
        created_time: "2026-06-01T00:00:00Z",
        properties: {
          Name: { type: "title", title: [{ plain_text: "Runbook: deploy" }] },
          Status: { type: "rich_text", rich_text: [{ plain_text: "active" }] },
        },
      },
    ],
    has_more: true,
    next_cursor: "CUR2",
  };
  const page2 = {
    results: [{ id: "p2", url: "u2", last_edited_time: "2026-06-09T00:00:00Z", properties: { Name: { type: "title", title: [{ plain_text: "ADR 5" }] } } }],
    has_more: false,
    next_cursor: null,
  };
  const fetchImpl: HttpFetch = async (_url, init) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    return resp(body.start_cursor === "CUR2" ? page2 : page1);
  };
  const conn = new NotionLiveConnector({ token: "t", fetchImpl });
  const recs = await conn.fetch();
  assert.equal(recs.length, 2, "2 sayfa cursor ile toplanmalı");
  assert.equal(recs[0].slug, "working/notion/p1");
  assert.equal(recs[0].type, "document");
  assert.equal(recs[0].title, "Runbook: deploy");
  assert.match(recs[0].content, /Status: active/, "rich_text property gövdeye düşmeli");
  assert.deepEqual(recs[0].acl, [{ kind: "group", principal: "notion:workspace" }]);
});

test("notion-live: since → azalan sıralıda eskiye geçince durur (incremental)", async () => {
  const fetchImpl: HttpFetch = async () =>
    resp({
      results: [
        { id: "new", last_edited_time: "2026-06-10T00:00:00Z", url: "u", properties: { N: { type: "title", title: [{ plain_text: "new" }] } } },
        { id: "old", last_edited_time: "2026-05-01T00:00:00Z", url: "u", properties: { N: { type: "title", title: [{ plain_text: "old" }] } } },
      ],
      has_more: false,
      next_cursor: null,
    });
  const conn = new NotionLiveConnector({ token: "t", since: "2026-06-01T00:00:00Z", fetchImpl });
  const recs = await conn.fetch();
  assert.equal(recs.length, 1, "yalnız since'ten yeni olan");
  assert.equal(recs[0].slug, "working/notion/new");
});

// --- Linear (GraphQL + cursor pagination) ---

test("linear-live: GraphQL → document; identifier slug; author kebab auto-link; cursor", async () => {
  const fetchImpl: HttpFetch = async (_url, init) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    const after = body.variables?.after ?? null;
    if (after === "CUR2") {
      return resp({
        data: { issues: { nodes: [{ id: "i3", identifier: "ENG-3", title: "Third", description: "d3", url: "u3", createdAt: "2026-06-03T00:00:00Z", creator: { name: "Jane Doe" } }], pageInfo: { hasNextPage: false, endCursor: null } } },
      });
    }
    return resp({
      data: { issues: { nodes: [{ id: "i1", identifier: "ENG-1", title: "First", description: "d1", url: "u1", createdAt: "2026-06-01T00:00:00Z", creator: { name: "alice" } }], pageInfo: { hasNextPage: true, endCursor: "CUR2" } } },
    });
  };
  const conn = new LinearLiveConnector({ token: "k", fetchImpl });
  const recs = await conn.fetch();
  assert.equal(recs.length, 2);
  assert.equal(recs[0].slug, "working/linear/ENG-1");
  assert.equal(recs[0].type, "document");
  assert.deepEqual(recs[0].acl, [{ kind: "group", principal: "linear:workspace" }]);
  const jane = recs.find((r) => r.slug === "working/linear/ENG-3")!;
  assert.match(jane.content, /\[\[durable\/people\/jane-doe\]\]/, "creator adı → kebab kişi-slug");
});

test("linear-live: GraphQL errors → açık hata (fail loud)", async () => {
  const fetchImpl: HttpFetch = async () => resp({ errors: [{ message: "authentication required" }] });
  const conn = new LinearLiveConnector({ token: "k", fetchImpl });
  await assert.rejects(() => conn.fetch(), /linear graphql/);
});

// --- Jira (offset pagination + ADF açıklama) ---

test("jira-live: offset pagination + ADF açıklama düz-metne; key slug; grup ACL", async () => {
  const page = (startAt: number) =>
    startAt === 0
      ? {
          total: 3,
          startAt: 0,
          maxResults: 2,
          issues: [
            { key: "ENG-1", fields: { summary: "Login bug", description: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "users cannot login" }] }] }, created: "2026-06-01T00:00:00Z", creator: { displayName: "Jane Doe" } } },
            { key: "ENG-2", fields: { summary: "Slow query", description: "plain desc", created: "2026-06-02T00:00:00Z", creator: { displayName: "bob" } } },
          ],
        }
      : { total: 3, startAt: 2, maxResults: 2, issues: [{ key: "ENG-3", fields: { summary: "Third", created: "2026-06-03T00:00:00Z" } }] };
  const fetchImpl: HttpFetch = async (url) => {
    const m = url.match(/startAt=(\d+)/);
    return resp(page(m ? Number(m[1]) : 0));
  };
  const conn = new JiraLiveConnector({ site: "acme", email: "me@acme.co", token: "t", fetchImpl, maxPages: 5 });
  const recs = await conn.fetch();
  assert.equal(recs.length, 3, "offset pagination ile 3 issue (2+1)");
  assert.equal(recs[0].slug, "working/jira/ENG-1");
  assert.equal(recs[0].type, "document");
  assert.match(recs[0].content, /users cannot login/, "ADF açıklama düz metne çevrilmeli");
  assert.match(recs[0].content, /\[\[durable\/people\/jane-doe\]\]/);
  assert.equal(recs[0].uri, "https://acme.atlassian.net/browse/ENG-1");
  assert.deepEqual(recs[0].acl, [{ kind: "group", principal: "jira:workspace" }]);
});

// --- Google Drive (pageToken + Google Doc export) ---

test("drive-live: pageToken pagination + Google Doc export; non-doc metadata; grup ACL", async () => {
  const list1 = {
    files: [
      { id: "f1", name: "Runbook", mimeType: "application/vnd.google-apps.document", modifiedTime: "2026-06-10T00:00:00Z", webViewLink: "https://drive/f1", owners: [{ displayName: "Alice" }] },
      { id: "f2", name: "diagram.png", mimeType: "image/png", modifiedTime: "2026-06-09T00:00:00Z", webViewLink: "https://drive/f2" },
    ],
    nextPageToken: "T2",
  };
  const list2 = { files: [{ id: "f3", name: "Notes", mimeType: "application/vnd.google-apps.document", modifiedTime: "2026-06-08T00:00:00Z" }] };
  const fetchImpl: HttpFetch = async (url) => {
    if (url.includes("/export")) return resp("EXPORTED DOC TEXT");
    if (url.includes("pageToken=T2")) return resp(list2);
    if (url.includes("/files")) return resp(list1);
    throw new Error("unexpected " + url);
  };
  const conn = new DriveLiveConnector({ token: "t", fetchImpl });
  const recs = await conn.fetch();
  assert.equal(recs.length, 3, "2 + 1 sayfa");
  assert.equal(recs[0].slug, "working/drive/f1");
  assert.match(recs[0].content, /EXPORTED DOC TEXT/, "Google Doc düz-metin export edilmeli");
  assert.match(recs[0].content, /\[\[durable\/people\/alice\]\]/);
  const png = recs.find((r) => r.slug === "working/drive/f2")!;
  assert.match(png.content, /image\/png/, "non-doc → mimeType metadata");
  assert.deepEqual(recs[0].acl, [{ kind: "group", principal: "drive:workspace" }]);
});

// --- Gmail (list + per-message fetch + MIME decode) ---

test("gmail-live: list + per-message fetch; base64url text/plain decode; subject title", async () => {
  const bodyB64 = Buffer.from("Merhaba, deploy tamam.").toString("base64url");
  const fetchImpl: HttpFetch = async (url) => {
    if (url.includes("/messages/m1")) {
      return resp({
        id: "m1",
        internalDate: "1700000000000",
        payload: {
          headers: [{ name: "Subject", value: "Deploy done" }, { name: "From", value: "alice@x" }, { name: "To", value: "team@x" }],
          mimeType: "text/plain",
          body: { data: bodyB64 },
        },
      });
    }
    if (url.includes("/messages?")) return resp({ messages: [{ id: "m1" }] });
    throw new Error("unexpected " + url);
  };
  const conn = new GmailLiveConnector({ token: "t", fetchImpl });
  const recs = await conn.fetch();
  assert.equal(recs.length, 1);
  assert.equal(recs[0].slug, "working/gmail/m1");
  assert.equal(recs[0].title, "Deploy done");
  assert.match(recs[0].content, /Merhaba, deploy tamam\./, "base64url gövde decode edilmeli");
  assert.match(recs[0].content, /From: alice@x/);
  assert.deepEqual(recs[0].acl, [{ kind: "group", principal: "gmail:workspace" }]);
});

// --- incremental ingest: prune opsiyonu (delta fetch eskileri SİLMEMELİ) ---

function fakeConnector(records: SourceRecord[]): Connector {
  return { name: "github", slugPrefix: "working/github/", fetch: async () => records };
}
function ghRecord(n: number): SourceRecord {
  return {
    sourceId: `o/r#${n}`,
    type: "note",
    tier: "working",
    title: `issue ${n}`,
    content: `body ${n}`,
    uri: `https://gh/${n}`,
    capturedAt: "2026-01-01T00:00:00Z",
    acl: [{ kind: "public", principal: PUBLIC_PRINCIPAL }],
    slug: `working/github/o/r/${n}`,
  };
}

test("ingest prune=false (delta): bu fetch'te olmayan eski kayıtlar SİLİNMEZ", async () => {
  const e = await freshEngine();
  try {
    // Tam senkron: #1 + #2.
    await ingest(e, fakeConnector([ghRecord(1), ghRecord(2)]));
    assert.ok(await e.getNode("working/github/o/r/1"));
    assert.ok(await e.getNode("working/github/o/r/2"));

    // Delta fetch: yalnız #2 güncellendi — prune=false → #1 KORUNMALI.
    const r = await ingest(e, fakeConnector([ghRecord(2)]), { prune: false });
    assert.equal(r.pruned, 0, "delta'da prune yapılmamalı");
    assert.ok(await e.getNode("working/github/o/r/1"), "eski #1 delta'da silinmemeli");
    assert.ok(await e.getNode("working/github/o/r/2"));
  } finally {
    await e.close();
  }
});

test("ingest prune=true (tam senkron): kaynakta olmayan kayıt soft-delete edilir", async () => {
  const e = await freshEngine();
  try {
    await ingest(e, fakeConnector([ghRecord(1), ghRecord(2)]));
    // Tam senkron yalnız #2 döndürür → #1 PRUNE edilmeli.
    const r = await ingest(e, fakeConnector([ghRecord(2)]), { prune: true });
    assert.equal(r.pruned, 1, "#1 prune edilmeli");
    assert.equal(await e.getNode("working/github/o/r/1"), null, "#1 silinmeli");
    assert.ok(await e.getNode("working/github/o/r/2"));
  } finally {
    await e.close();
  }
});
