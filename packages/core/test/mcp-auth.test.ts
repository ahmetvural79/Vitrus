import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import { MarkdownStore } from "../src/store/markdown-store.js";
import { StaticTokenVerifier, protectedResourceMetadata, verifierFromEnv } from "../src/mcp/auth.js";
import { callTool } from "../src/mcp/tools.js";
import { runHttp } from "../src/mcp/server.js";

const RESOURCE = "http://localhost:3919/mcp";

async function buildEngine(): Promise<PgliteEngine> {
  const brainDir = join(dirname(fileURLToPath(import.meta.url)), "..", "brain");
  const e = new PgliteEngine({ embedder: new HashingEmbedder() });
  await e.init();
  for (const { node, edges } of new MarkdownStore(brainDir).readAll()) await e.putNode(node, edges);
  return e;
}

test("StaticTokenVerifier: doğru aud → kimlik; yanlış aud → null (RFC 8707)", async () => {
  const v = new StaticTokenVerifier(RESOURCE, {
    good: { user: "alice", aud: RESOURCE },
    wrongAud: { user: "bob", aud: "http://other/mcp" },
  });
  assert.deepEqual(await v.verify("good"), { user: "alice" });
  assert.equal(await v.verify("wrongAud"), null, "yanlış audience reddedilmeli");
  assert.equal(await v.verify("yok"), null);
});

test("protectedResourceMetadata + verifierFromEnv", () => {
  const m = protectedResourceMetadata(RESOURCE, ["https://as.example"]);
  assert.equal(m.resource, RESOURCE);
  assert.deepEqual(m.authorization_servers, ["https://as.example"]);
  const v = verifierFromEnv(RESOURCE, "tok1:alice,tok2:bob");
  assert.ok(v);
});

test("callTool: kimlik (principals) → ACL uygulanır (yetkisiz özel doc sızmaz)", async () => {
  const e = await buildEngine();
  try {
    const out = await callTool(e, "search", { query: "gateway kesinti incident", limit: 20 }, { principals: ["__outsider__"] });
    const slugs = (out.structuredContent as { hits: { slug: string }[] }).hits.map((h) => h.slug);
    assert.ok(!slugs.includes("durable/incidents/2026-05-12-gateway-outage"), "yetkisiz sızmamalı");

    const ok = await callTool(e, "search", { query: "gateway kesinti incident", limit: 20 }, { principals: ["eng"] });
    const okSlugs = (ok.structuredContent as { hits: { slug: string }[] }).hits.map((h) => h.slug);
    assert.ok(okSlugs.includes("durable/incidents/2026-05-12-gateway-outage"), "yetkili görmeli");

    // provenance: yetkisiz → found:false
    const prov = await callTool(e, "provenance", { slug: "durable/incidents/2026-05-12-gateway-outage" }, { principals: ["__outsider__"] });
    assert.equal((prov.structuredContent as { found: boolean }).found, false);
  } finally {
    await e.close();
  }
});

test("HTTP: PRM endpoint açık; /mcp Bearer'sız → 401 + WWW-Authenticate", async () => {
  const e = await buildEngine();
  const verifier = new StaticTokenVerifier(RESOURCE, { t: { user: "alice", aud: RESOURCE } });
  const srv = await runHttp(e, 3919, { verifier, resource: RESOURCE, authServers: ["https://as.example"] });
  try {
    const prm = await fetch("http://localhost:3919/.well-known/oauth-protected-resource");
    assert.equal(prm.status, 200);
    const meta = await prm.json();
    assert.equal(meta.resource, RESOURCE);

    const noAuth = await fetch("http://localhost:3919/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(noAuth.status, 401, "Bearer'sız 401");
    assert.match(noAuth.headers.get("www-authenticate") ?? "", /resource_metadata=/);
  } finally {
    await new Promise<void>((r) => srv.close(() => r()));
    await e.close();
  }
});
