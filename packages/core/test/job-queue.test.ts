import { test } from "node:test";
import assert from "node:assert/strict";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import { JobQueue, workOff } from "../src/core/job-queue.js";

async function freshQueue(): Promise<{ engine: PgliteEngine; q: JobQueue }> {
  const engine = new PgliteEngine({ embedder: new HashingEmbedder() });
  await engine.init();
  return { engine, q: engine.getQueue() };
}

test("enqueue → claim → complete: iki-fazlı yaşam döngüsü + sonuç saklanır", async () => {
  const { engine, q } = await freshQueue();
  const { id } = await q.enqueue("think", { query: "x" });
  assert.ok(id && id > 0);

  const job = await q.claim();
  assert.equal(job?.kind, "think");
  assert.equal(job?.status, "running");
  assert.equal(job?.attempts, 1);
  assert.equal(job?.payload.query, "x");

  await q.complete(job!.id, { answer: "ok" });
  const got = await q.get(job!.id);
  assert.equal(got?.status, "done");
  assert.deepEqual(got?.result, { answer: "ok" });

  assert.equal(await q.claim(), null); // kuyruk boş
  await engine.close();
});

test("idempotent enqueue: aktif dedupKey tek iş; tamamlanınca yeniden kuyruğa girebilir", async () => {
  const { engine, q } = await freshQueue();
  const a = await q.enqueue("think", { query: "q" }, { dedupKey: "k1" });
  const b = await q.enqueue("think", { query: "q" }, { dedupKey: "k1" });
  assert.equal(a.deduped, false);
  assert.equal(b.deduped, true);
  assert.equal(b.id, a.id); // aynı aktif iş

  const job = await q.claim();
  await q.complete(job!.id);
  // Tamamlandı → aynı anahtar yeni iş açabilir (unique index yalnız aktif statüde).
  const c = await q.enqueue("think", { query: "q" }, { dedupKey: "k1" });
  assert.equal(c.deduped, false);
  assert.notEqual(c.id, a.id);
  await engine.close();
});

test("fail: attempts<max → requeue; max'a ulaşınca failed", async () => {
  const { engine, q } = await freshQueue();
  await q.enqueue("think", {}, { maxAttempts: 2 });

  const j1 = await q.claim(); // attempts=1
  const r1 = await q.fail(j1!.id, "boom");
  assert.equal(r1.requeued, true); // 1<2 → tekrar kuyruğa

  const j2 = await q.claim(); // attempts=2
  assert.equal(j2?.id, j1?.id);
  const r2 = await q.fail(j2!.id, "boom again");
  assert.equal(r2.requeued, false); // 2==2 → failed

  const got = await q.get(j1!.id);
  assert.equal(got?.status, "failed");
  assert.equal(got?.lastError, "boom again");
  await engine.close();
});

test("crash recovery: lease'i geçmiş running iş recover() ile yeniden talep edilebilir", async () => {
  const { engine, q } = await freshQueue();
  await q.enqueue("think", { query: "z" });
  const job = await q.claim({ leaseMs: -1 }); // lease GEÇMİŞTE → çökmüş işçi simülasyonu
  assert.equal(job?.status, "running");

  // İşçi çöktü, complete edilmedi. Açık süpürme reclaim eder.
  const reclaimed = await q.recover();
  assert.equal(reclaimed, 1);

  const again = await q.claim(); // yeniden talep edilebilir
  assert.equal(again?.id, job?.id);
  assert.equal(again?.attempts, 2); // ikinci deneme
  await engine.close();
});

test("workOff: kuyruğu işler, crash'lı işi kurtarır, kalıcı hatayı failed yapar", async () => {
  const { engine, q } = await freshQueue();
  // 2 sağlıklı iş + 1 çökmüş (running, lease geçmiş) + 1 hep-hatalı.
  await q.enqueue("ok", { n: 1 });
  await q.enqueue("ok", { n: 2 });
  await q.enqueue("ok", { n: 3 });
  const crashed = await q.claim({ leaseMs: -1 }); // 'running', süresi geçmiş → workOff recover etmeli
  assert.equal(crashed?.payload.n, 1);
  await q.enqueue("bad", {}, { maxAttempts: 2 });

  const handler = async (job: { kind: string }) => {
    if (job.kind === "bad") throw new Error("always fails");
    return { ok: true };
  };
  const r = await workOff(q, handler);
  // 3 ok done; bad 2 denemede failed.
  assert.equal(r.done, 3);
  assert.equal(r.failed, 1);
  const s = await q.stats();
  assert.equal(s.done, 3);
  assert.equal(s.failed, 1);
  assert.equal(s.queued, 0);
  assert.equal(s.running, 0);
  await engine.close();
});

test("getQueue opsiyonel capability olarak BrainEngine'de mevcut", async () => {
  const { engine } = await freshQueue();
  assert.equal(typeof engine.getQueue, "function");
  await engine.close();
});
