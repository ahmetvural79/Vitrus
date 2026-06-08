import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { SessionConnector } from "../src/connectors/sessions.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "sessions");

test("SessionConnector: .jsonl oturumu → session düğümü, PRIVATE ACL, muhakeme transcript'i", async () => {
  const recs = await new SessionConnector(fixturesDir, { owner: "ahmet", scope: "onboarding" }).fetch();
  assert.equal(recs.length, 1);
  const r = recs[0];
  assert.equal(r.type, "session");
  assert.equal(r.tier, "working");
  assert.equal(r.slug, "working/sessions/onboarding-debug");
  assert.deepEqual(r.acl, [{ kind: "user", principal: "ahmet" }]); // PRIVATE (fail-closed temeli)
  assert.equal(r.scope, "onboarding");
  assert.ok(r.retentionDays && r.retentionDays > 0); // TTL varsayılanı
  assert.match(r.title, /Gateway/); // başlık ilk user mesajından
  assert.match(r.content, /rate-limit dalını eliyorum/); // budanmış dal — "repo'da kalmayan muhakeme"
  assert.match(r.content, /auth latency/);
  assert.equal(r.capturedAt, "2026-05-20T10:00:00Z");
});

test("SessionConnector: tek dosya yolu da kabul edilir", async () => {
  const recs = await new SessionConnector(join(fixturesDir, "onboarding-debug.jsonl"), { owner: "x" }).fetch();
  assert.equal(recs.length, 1);
  assert.equal(recs[0].type, "session");
});

test("SessionConnector: Claude Code-benzeri {type,message:{role,content[]}} formatını toleranslı çözer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vitrus-sess-"));
  try {
    writeFileSync(
      join(dir, "s.jsonl"),
      [
        JSON.stringify({ type: "user", message: { role: "user", content: "merhaba" }, timestamp: "2026-01-01T00:00:00Z" }),
        JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "selam" }] } }),
        "BU SATIR JSON DEĞİL", // bozuk satır atlanmalı
      ].join("\n")
    );
    const recs = await new SessionConnector(dir, { owner: "x" }).fetch();
    assert.equal(recs.length, 1);
    assert.match(recs[0].content, /user: merhaba/);
    assert.match(recs[0].content, /assistant: selam/); // content array → text bloğu birleşti
    assert.equal(recs[0].capturedAt, "2026-01-01T00:00:00Z");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
