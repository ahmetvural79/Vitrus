import { test } from "node:test";
import assert from "node:assert/strict";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { PostgresEngine, engineFromEnv } from "../src/core/postgres-engine.js";
import { PgDriver, PgliteDriver } from "../src/core/sql-driver.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";

const E = new HashingEmbedder();

test("engineFromEnv: env yoksa PGLite; VITRUS_PG_URL/DATABASE_URL varsa Postgres", () => {
  assert.ok(engineFromEnv({ embedder: E }, {}) instanceof PgliteEngine);
  assert.equal(engineFromEnv({ embedder: E }, {}) instanceof PostgresEngine, false);

  const pg = engineFromEnv({ embedder: E }, { VITRUS_PG_URL: "postgres://u@h/db" });
  assert.ok(pg instanceof PostgresEngine);
  assert.ok(pg instanceof PgliteEngine); // ortak SQL'i miras alır

  assert.ok(engineFromEnv({ embedder: E }, { DATABASE_URL: "postgres://u@h/db" }) instanceof PostgresEngine);
});

test("PostgresEngine/PgDriver: bağlanmadan kurulur (pg tembel yüklenir)", () => {
  // Construction CONNECT etmez → pg kurulu olmasa bile patlamaz (offline kapı güvenliği).
  const eng = new PostgresEngine({ connectionString: "postgres://nope@localhost/x", embedder: E });
  assert.ok(eng instanceof PgliteEngine);
  const d = new PgDriver("postgres://nope@localhost/x");
  assert.equal(typeof d.query, "function"); // lazy: henüz import("pg") yok
});

test("PgliteDriver şeffaflığı: motor sürücü üstünden tam çalışır (import→search)", async () => {
  // Tüm suite zaten PgliteDriver üstünden koşuyor; bu, sürücü yolunu açıkça doğrular.
  const engine = new PgliteEngine({ embedder: E });
  await engine.init();
  await engine.putNode({
    slug: "durable/people/alice", type: "person", tier: "durable", title: "Alice",
    content: "Alice ödeme servisinden sorumlu.", frontmatter: {}, salience: 0.5,
    provenance: { connector: null, sourceId: null, uri: null, capturedAt: null },
    acl: [], contentHash: "h1",
  });
  const hits = await engine.search("ödeme servisi", { limit: 5 });
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].node.slug, "durable/people/alice");
  // Kuyruk da aynı sürücü üstünde
  const q = engine.getQueue();
  const { id } = await q.enqueue("think", { query: "x" });
  assert.ok(id && id > 0);
  await engine.close();
  void PgliteDriver;
});
