import { test } from "node:test";
import assert from "node:assert/strict";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import { ChangeQueue } from "../src/connectors/webhook.js";
import { parseGitHubWebhook, slackWebhookChannel } from "../src/connectors/webhooks.js";
import { buildConnector, runSyncJob, syncDedupKey } from "../src/connectors/sync.js";
import { GitHubLiveConnector } from "../src/connectors/github-live.js";
import { SlackLiveConnector } from "../src/connectors/slack-live.js";
import { NotionLiveConnector } from "../src/connectors/notion-live.js";
import { LinearLiveConnector } from "../src/connectors/linear-live.js";
import { JiraLiveConnector } from "../src/connectors/jira-live.js";
import { DriveLiveConnector } from "../src/connectors/drive-live.js";
import { GmailLiveConnector } from "../src/connectors/gmail-live.js";
import type { HttpFetch, HttpResponse } from "../src/connectors/http.js";
import { PUBLIC_PRINCIPAL } from "../src/core/types.js";

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

// --- GitHub webhook parser (canlı delta hattı) ---

test("parseGitHubWebhook: issue opened → upsert; slug/sourceId/ACL connector ile aynı", () => {
  const events = parseGitHubWebhook({
    action: "opened",
    issue: { number: 5, title: "Bug", body: "broken", html_url: "https://gh/5", created_at: "2026-01-01T00:00:00Z", user: { login: "alice" } },
    repository: { full_name: "o/r", private: false },
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].action, "upsert");
  assert.equal(events[0].record!.slug, "working/github/o/r/5");
  assert.equal(events[0].record!.sourceId, "o/r#5");
  assert.equal(events[0].record!.type, "note");
  assert.deepEqual(events[0].record!.acl, [{ kind: "public", principal: PUBLIC_PRINCIPAL }]);
  assert.match(events[0].record!.content, /\[\[durable\/people\/alice\]\]/);
});

test("parseGitHubWebhook: PR opened → document; private repo → grup ACL", () => {
  const events = parseGitHubWebhook({
    action: "opened",
    pull_request: { number: 7, title: "Add cache", body: "x", html_url: "u7", created_at: "t", user: { login: "bob" } },
    repository: { full_name: "o/r", private: true },
  });
  assert.equal(events[0].record!.type, "document");
  assert.deepEqual(events[0].record!.acl, [{ kind: "group", principal: "github:o/r" }]);
});

test("parseGitHubWebhook: deleted → delete event (slug ile)", () => {
  const events = parseGitHubWebhook({
    action: "deleted",
    issue: { number: 5 },
    repository: { full_name: "o/r", private: false },
  });
  assert.equal(events[0].action, "delete");
  assert.equal(events[0].slug, "working/github/o/r/5");
});

test("github webhook → ChangeQueue → engine: upsert sonra delete (canlı delta)", async () => {
  const e = await freshEngine();
  try {
    const up = parseGitHubWebhook({
      action: "opened",
      issue: { number: 9, title: "Outage", body: "down", html_url: "u9", created_at: "2026-01-01T00:00:00Z", user: { login: "alice" } },
      repository: { full_name: "o/r", private: false },
    });
    const q = new ChangeQueue();
    for (const ev of up) q.enqueue(ev);
    await q.drain(e);
    assert.ok(await e.getNode("working/github/o/r/9"), "upsert sonrası düğüm olmalı");

    const del = parseGitHubWebhook({ action: "deleted", issue: { number: 9 }, repository: { full_name: "o/r", private: false } });
    const q2 = new ChangeQueue();
    for (const ev of del) q2.enqueue(ev);
    await q2.drain(e);
    assert.equal(await e.getNode("working/github/o/r/9"), null, "delete sonrası düğüm gitmeli");
  } finally {
    await e.close();
  }
});

test("slackWebhookChannel: event.channel çıkarır", () => {
  assert.equal(slackWebhookChannel({ event: { type: "message", channel: "C123", ts: "1" } }), "C123");
  assert.equal(slackWebhookChannel({ channel_id: "C999" }), "C999");
  assert.equal(slackWebhookChannel({}), null);
});

// --- sync orkestrasyonu (durable queue primitifi) ---

test("buildConnector: source'a göre doğru connector; token yoksa açık hata", () => {
  assert.ok(buildConnector({ source: "github", repo: "o/r" }, { GITHUB_TOKEN: "t" }) instanceof GitHubLiveConnector);
  assert.ok(buildConnector({ source: "slack", channel: "C1" }, { SLACK_TOKEN: "t" }) instanceof SlackLiveConnector);
  assert.ok(buildConnector({ source: "notion" }, { NOTION_TOKEN: "t" }) instanceof NotionLiveConnector);
  assert.ok(buildConnector({ source: "linear" }, { LINEAR_API_KEY: "t" }) instanceof LinearLiveConnector);
  assert.ok(buildConnector({ source: "jira", site: "acme", email: "e@x" }, { JIRA_API_TOKEN: "t" }) instanceof JiraLiveConnector);
  assert.ok(buildConnector({ source: "drive" }, { GOOGLE_TOKEN: "t" }) instanceof DriveLiveConnector);
  assert.ok(buildConnector({ source: "gmail" }, { GOOGLE_TOKEN: "t" }) instanceof GmailLiveConnector);
  assert.throws(() => buildConnector({ source: "github", repo: "o/r" }, {}), /GITHUB_TOKEN/);
  assert.throws(() => buildConnector({ source: "slack", channel: "C1" }, {}), /SLACK_TOKEN/);
  assert.throws(() => buildConnector({ source: "notion" }, {}), /NOTION_TOKEN/);
  assert.throws(() => buildConnector({ source: "linear" }, {}), /LINEAR_API_KEY/);
  assert.throws(() => buildConnector({ source: "jira", site: "acme", email: "e@x" }, {}), /JIRA_API_TOKEN/);
  assert.throws(() => buildConnector({ source: "jira" }, { JIRA_API_TOKEN: "t" }), /site.*email/);
  assert.throws(() => buildConnector({ source: "drive" }, {}), /GOOGLE_TOKEN/);
  assert.throws(() => buildConnector({ source: "gmail" }, {}), /GOOGLE_TOKEN/);
});

test("syncDedupKey: kaynak başına kararlı (aynı repo → aynı anahtar)", () => {
  assert.equal(syncDedupKey({ source: "github", repo: "o/r" }), "sync:github:o/r");
  assert.equal(syncDedupKey({ source: "slack", channel: "C1" }), "sync:slack:C1");
});

test("runSyncJob (github, mock fetch): connector kurup incremental ingest eder", async () => {
  const e = await freshEngine();
  try {
    const fetchImpl: HttpFetch = async (url) => {
      if (url.endsWith("/repos/o/r")) return resp({ private: false });
      if (url.includes("/issues")) {
        return resp([
          { number: 1, title: "a", body: "x", html_url: "u1", created_at: "2026-01-01T00:00:00Z", user: { login: "alice" } },
          { number: 2, title: "b", body: "y", html_url: "u2", created_at: "2026-01-02T00:00:00Z", user: { login: "bob" } },
        ]);
      }
      throw new Error("unexpected url " + url);
    };
    const r = await runSyncJob(e, { source: "github", repo: "o/r" }, { env: { GITHUB_TOKEN: "t" }, fetchImpl });
    assert.equal(r.upserted, 2);
    assert.ok(await e.getNode("working/github/o/r/1"));
    assert.ok(await e.getNode("working/github/o/r/2"));
  } finally {
    await e.close();
  }
});

test("sync job: durable queue üzerinden enqueue→work (handler runSyncJob)", async () => {
  const e = await freshEngine();
  try {
    const queue = e.getQueue();
    const fetchImpl: HttpFetch = async (url) => {
      if (url.endsWith("/repos/o/r")) return resp({ private: false });
      if (url.includes("/issues")) return resp([{ number: 3, title: "c", body: "z", html_url: "u3", created_at: "2026-01-03T00:00:00Z", user: { login: "carol" } }]);
      throw new Error("unexpected url " + url);
    };
    const p = { source: "github" as const, repo: "o/r" };
    const { id, deduped } = await queue.enqueue("sync", p as unknown as Record<string, unknown>, { dedupKey: syncDedupKey(p) });
    assert.equal(deduped, false);
    assert.ok(id);
    // İkinci enqueue → dedup (aynı kaynak için tek aktif iş).
    const again = await queue.enqueue("sync", p as unknown as Record<string, unknown>, { dedupKey: syncDedupKey(p) });
    assert.equal(again.deduped, true);

    // Worker: işi claim et + runSyncJob ile işle.
    const { workOff } = await import("../src/core/job-queue.js");
    const r = await workOff(queue, (job) => runSyncJob(e, job.payload as any, { env: { GITHUB_TOKEN: "t" }, fetchImpl }), { max: 5 });
    assert.equal(r.done, 1);
    assert.ok(await e.getNode("working/github/o/r/3"), "sync işi düğümü yazmalı");
  } finally {
    await e.close();
  }
});
