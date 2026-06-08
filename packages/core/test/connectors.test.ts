import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import { ingest } from "../src/connectors/ingest.js";
import { SlackConnector } from "../src/connectors/slack.js";
import { GitHubConnector } from "../src/connectors/github.js";
import { McpSourceConnector } from "../src/connectors/mcp-source.js";
import type { Connector } from "../src/connectors/types.js";

const fix = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const slackFix = join(fix, "slack-export.json");
const githubFix = join(fix, "github-export.json");

async function freshEngine(): Promise<PgliteEngine> {
  const e = new PgliteEngine({ embedder: new HashingEmbedder() });
  await e.init();
  return e;
}

test("Slack: thread→düğüm, provenance+ACL, @mention→kişi kenarı (auto-link)", async () => {
  const e = await freshEngine();
  try {
    const r = await ingest(e, new SlackConnector(slackFix));
    assert.equal(r.upserted, 2); // 2 thread (biri yanıtlı)
    const node = await e.getNode("working/slack/platform/1715500000-000100");
    assert.ok(node, "thread düğümü olmalı");
    assert.equal(node!.provenance.connector, "slack");
    assert.ok(node!.acl.some((a) => a.kind === "group" && a.principal === "slack:platform"));
    // <@U0BOB> → [[durable/people/bob]] → mentions kenarı
    const edges = await e.getConnections("working/slack/platform/1715500000-000100");
    assert.ok(edges.some((x) => x.toId === "durable/people/bob"));
  } finally {
    await e.close();
  }
});

test("ingest idempotent: iki koşu dup üretmez", async () => {
  const e = await freshEngine();
  try {
    await ingest(e, new SlackConnector(slackFix));
    const r2 = await ingest(e, new SlackConnector(slackFix));
    assert.equal(r2.pruned, 0, "hepsi tekrar görüldü → budama yok");
    // arama hâlâ tek düğüm döndürür (upsert)
    const hits = await e.search("postmortem katılımcılar", { limit: 10 });
    const slugs = hits.map((h) => h.node.slug);
    assert.equal(new Set(slugs).size, slugs.length, "tekrarsız");
  } finally {
    await e.close();
  }
});

test("prune: kaynakta olmayan kayıt soft-delete (incremental_sync)", async () => {
  const e = await freshEngine();
  try {
    await ingest(e, new SlackConnector(slackFix)); // 2 düğüm
    // sonraki senkron yalnız 1 thread döndürür → diğeri budanmalı
    const shrunk: Connector = {
      name: "slack",
      slugPrefix: "working/slack/",
      async fetch() {
        return [
          {
            sourceId: "C0PLATFORM/1715600000.000300",
            type: "note",
            title: "kalan",
            content: "kalan thread",
            uri: null,
            capturedAt: null,
            acl: [],
            slug: "working/slack/platform/1715600000-000300",
          },
        ];
      },
    };
    const r = await ingest(e, shrunk);
    assert.equal(r.pruned, 1);
    assert.equal(await e.getNode("working/slack/platform/1715500000-000100"), null, "budanan null");
    assert.ok(await e.getNode("working/slack/platform/1715600000-000300"), "kalan durur");
  } finally {
    await e.close();
  }
});

test("GitHub: PR→document, private→grup ACL, yazar→kişi kenarı", async () => {
  const e = await freshEngine();
  try {
    const r = await ingest(e, new GitHubConnector(githubFix));
    assert.equal(r.upserted, 2);
    const pr = await e.getNode("working/github/org/api-gateway/43");
    assert.ok(pr);
    assert.equal(pr!.type, "document");
    assert.ok(pr!.acl.some((a) => a.kind === "group" && a.principal === "github:org/api-gateway"));
    const edges = await e.getConnections("working/github/org/api-gateway/43");
    assert.ok(edges.some((x) => x.toId === "durable/people/bob"));
  } finally {
    await e.close();
  }
});

test("MCP-source köprüsü: yukarı-akış resource → kaynak (duck-typed client)", async () => {
  const e = await freshEngine();
  try {
    const client = {
      async listResources() {
        return { resources: [{ uri: "file://doc1", name: "Doc 1" }] };
      },
      async readResource({ uri }: { uri: string }) {
        return { contents: [{ uri, text: "İçerik bir [[durable/x]]" }] };
      },
    };
    const r = await ingest(e, new McpSourceConnector("notion", client));
    assert.equal(r.upserted, 1);
    const node = await e.getNode("working/mcp/notion/doc1");
    assert.ok(node);
    assert.equal(node!.provenance.connector, "mcp:notion");
    assert.match(node!.content, /İçerik/);
  } finally {
    await e.close();
  }
});
