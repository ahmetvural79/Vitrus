import { test } from "node:test";
import assert from "node:assert/strict";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import { verifyClaim } from "../src/verify/verify.js";
import type { KnowledgeNode } from "../src/core/types.js";

function n(slug: string, content: string): Omit<KnowledgeNode, "id" | "createdAt" | "updatedAt"> {
  return {
    slug,
    type: "note",
    tier: "durable",
    title: slug,
    content,
    frontmatter: {},
    salience: 0.5,
    provenance: { connector: null, sourceId: null, uri: null, capturedAt: null },
    acl: [],
    contentHash: "h-" + slug,
  };
}

async function brain(): Promise<PgliteEngine> {
  const e = new PgliteEngine({ embedder: new HashingEmbedder() });
  await e.init();
  // A süpersede eder B (ayrık kelime dağarcığı → temiz izolasyon); C çelişir D.
  await e.putNode(n("durable/x/b", "beta widget deprecated removed legacy"));
  await e.putNode(n("durable/x/d", "delta gateway throughput thousand"));
  await e.putNode(n("durable/x/a", "alpha module active current shipped [[supersedes::durable/x/b]]"));
  await e.putNode(n("durable/x/c", "gamma gateway throughput hundred [[contradicts::durable/x/d]]"));
  return e;
}

test("verifyClaim: GROUNDED — güncel kaynak destekliyor, çelişki/bayat yok", async () => {
  const e = await brain();
  try {
    const r = await verifyClaim(e, "alpha module active shipped");
    assert.equal(r.status, "grounded");
    assert.ok(r.support.some((s) => s.slug === "durable/x/a"));
    assert.ok(r.confidence > 0);
  } finally {
    await e.close();
  }
});

test("verifyClaim: STALE — destekleyen kaynak süpersede edilmiş", async () => {
  const e = await brain();
  try {
    const r = await verifyClaim(e, "beta widget deprecated legacy");
    assert.equal(r.status, "stale");
    assert.ok(r.conflicts.some((c) => c.kind === "stale"));
  } finally {
    await e.close();
  }
});

test("verifyClaim: CONTRADICTED — destekleyen kaynak çelişki içinde", async () => {
  const e = await brain();
  try {
    const r = await verifyClaim(e, "gamma gateway throughput hundred");
    assert.equal(r.status, "contradicted");
    assert.ok(r.conflicts.some((c) => c.kind === "contradiction"));
  } finally {
    await e.close();
  }
});

test("verifyClaim: UNSUPPORTED — beyinde hiçbir kaynak desteklemiyor (self-report'a güvenme)", async () => {
  const e = await brain();
  try {
    const r = await verifyClaim(e, "zeppelin quantum unicorn nonexistent");
    assert.equal(r.status, "unsupported");
    assert.equal(r.support.length, 0);
    assert.equal(r.confidence, 0);
  } finally {
    await e.close();
  }
});
