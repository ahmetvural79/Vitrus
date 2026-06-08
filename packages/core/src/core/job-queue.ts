// src/core/job-queue.ts
// Dayanıklı iş kuyruğu (gbrain paritesi). Postgres-native → PGLite ve Postgres+pgvector
// için AYNI SQL (ayrı broker yok). İki-fazlı kalıcılık + lease tabanlı crash recovery:
//   enqueue → claim (status=running + lease_until) → complete | fail(requeue/failed)
// İşçi çökerse lease_until geçer ve iş yeniden talep edilebilir → "hiç iş kaybolmaz".
//
// DB bağımlılığı yapısal (SqlLike): hem PGlite hem node-postgres aynı {rows} şeklini döndürür,
// böylece queue motordan ve sürücüden bağımsız test edilir.

/** Asgari SQL yüzeyi — PGlite.query ve pg.Pool.query bunu karşılar. */
export interface SqlLike {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface Job {
  id: number;
  kind: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  leaseUntil: string | null;
  lastError: string | null;
  result: unknown;
  dedupKey: string | null;
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
}

interface JobRow {
  id: number | string | bigint;
  kind: string;
  payload: Record<string, unknown> | null;
  status: JobStatus;
  priority: number;
  attempts: number;
  max_attempts: number;
  lease_until: Date | string | null;
  last_error: string | null;
  result: unknown;
  dedup_key: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  done_at: Date | string | null;
}

function toISO(v: Date | string | null): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function rowToJob(r: JobRow): Job {
  return {
    id: Number(r.id),
    kind: r.kind,
    payload: r.payload ?? {},
    status: r.status,
    priority: r.priority,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    leaseUntil: toISO(r.lease_until),
    lastError: r.last_error ?? null,
    result: r.result ?? null,
    dedupKey: r.dedup_key ?? null,
    createdAt: toISO(r.created_at)!,
    updatedAt: toISO(r.updated_at)!,
    doneAt: toISO(r.done_at),
  };
}

export interface EnqueueOpts {
  priority?: number;
  maxAttempts?: number;
  /** İdempotent enqueue: aynı anahtarla aktif (queued/running) iş tek olur. */
  dedupKey?: string;
}

export class JobQueue {
  constructor(private readonly db: SqlLike) {}

  /** Yeni iş kuyruğa al. dedupKey ile aktif kopya varsa onu döndürür (deduped=true). */
  async enqueue(kind: string, payload: Record<string, unknown> = {}, opts: EnqueueOpts = {}): Promise<{ id: number | null; deduped: boolean }> {
    const { rows } = await this.db.query<{ id: number | string }>(
      `INSERT INTO jobs (kind, payload, priority, max_attempts, dedup_key)
       VALUES ($1, $2::jsonb, $3, $4, $5)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [kind, JSON.stringify(payload), opts.priority ?? 0, opts.maxAttempts ?? 3, opts.dedupKey ?? null]
    );
    if (rows[0]) return { id: Number(rows[0].id), deduped: false };
    // Çakışma (aktif dedup_key): mevcut aktif işi döndür.
    if (opts.dedupKey) {
      const { rows: ex } = await this.db.query<{ id: number | string }>(
        `SELECT id FROM jobs WHERE dedup_key=$1 AND status IN ('queued','running') ORDER BY id LIMIT 1`,
        [opts.dedupKey]
      );
      if (ex[0]) return { id: Number(ex[0].id), deduped: true };
    }
    return { id: null, deduped: true };
  }

  /**
   * Sıradaki işi ATOMİK talep et: queued VEYA lease'i geçmiş running (crash reclaim).
   * status=running + attempts+1 + lease_until set. FOR UPDATE SKIP LOCKED → çok-işçi güvenli
   * (gerçek Postgres'te paralel worker double-claim yapmaz; PGlite tek-bağlantıda da çalışır).
   */
  async claim(opts: { leaseMs?: number } = {}): Promise<Job | null> {
    const leaseMs = opts.leaseMs ?? 30_000;
    const { rows } = await this.db.query<JobRow>(
      `WITH next AS (
         SELECT id FROM jobs
         WHERE status='queued' OR (status='running' AND lease_until < now())
         ORDER BY priority DESC, id ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE jobs j SET status='running', attempts=attempts+1,
              lease_until = now() + ($1::int * interval '1 millisecond'), updated_at=now()
       FROM next WHERE j.id = next.id
       RETURNING j.*`,
      [leaseMs]
    );
    return rows[0] ? rowToJob(rows[0]) : null;
  }

  /** Uzun işlerde lease'i uzat (worker hâlâ canlı). */
  async heartbeat(id: number, leaseMs = 30_000): Promise<void> {
    await this.db.query(
      `UPDATE jobs SET lease_until = now() + ($2::int * interval '1 millisecond'), updated_at=now()
       WHERE id=$1 AND status='running'`,
      [id, leaseMs]
    );
  }

  /** Başarı: status=done + sonuç sakla (denetlenebilir). */
  async complete(id: number, result?: unknown): Promise<void> {
    await this.db.query(
      `UPDATE jobs SET status='done', result=$2::jsonb, lease_until=NULL, done_at=now(), updated_at=now() WHERE id=$1`,
      [id, result === undefined ? null : JSON.stringify(result)]
    );
  }

  /** Hata: attempts<max ise tekrar kuyruğa (requeued), değilse failed. */
  async fail(id: number, error: string): Promise<{ requeued: boolean }> {
    const { rows } = await this.db.query<{ requeued: boolean }>(
      `UPDATE jobs SET
         status = CASE WHEN attempts < max_attempts THEN 'queued' ELSE 'failed' END,
         last_error = $2, lease_until = NULL, updated_at = now(),
         done_at = CASE WHEN attempts < max_attempts THEN NULL ELSE now() END
       WHERE id = $1
       RETURNING (status='queued') AS requeued`,
      [id, error]
    );
    return { requeued: rows[0]?.requeued ?? false };
  }

  /** Açık crash-recovery süpürmesi: lease'i geçmiş running işleri queued'a al. Sayı döner. */
  async recover(): Promise<number> {
    const { rows } = await this.db.query<{ id: number }>(
      `UPDATE jobs SET status='queued', lease_until=NULL, updated_at=now()
       WHERE status='running' AND lease_until < now() RETURNING id`
    );
    return rows.length;
  }

  async stats(): Promise<Record<JobStatus, number>> {
    const { rows } = await this.db.query<{ status: JobStatus; n: number }>(
      `SELECT status, count(*)::int AS n FROM jobs GROUP BY status`
    );
    const out: Record<JobStatus, number> = { queued: 0, running: 0, done: 0, failed: 0 };
    for (const r of rows) out[r.status] = Number(r.n);
    return out;
  }

  async list(opts: { status?: JobStatus; limit?: number } = {}): Promise<Job[]> {
    const limit = opts.limit ?? 50;
    const { rows } = opts.status
      ? await this.db.query<JobRow>(`SELECT * FROM jobs WHERE status=$1 ORDER BY id DESC LIMIT $2`, [opts.status, limit])
      : await this.db.query<JobRow>(`SELECT * FROM jobs ORDER BY id DESC LIMIT $1`, [limit]);
    return rows.map(rowToJob);
  }

  async get(id: number): Promise<Job | null> {
    const { rows } = await this.db.query<JobRow>(`SELECT * FROM jobs WHERE id=$1`, [id]);
    return rows[0] ? rowToJob(rows[0]) : null;
  }
}

/**
 * İşçi döngüsü: claim → handler → complete/fail. Önce crash'lı lease'leri kurtarır (recover).
 * handler hata atarsa fail() (attempts<max → requeue). max ile sınırlanır; kuyruk boşalınca durur.
 */
export async function workOff(
  queue: JobQueue,
  handler: (job: Job) => Promise<unknown>,
  opts: { max?: number; leaseMs?: number } = {}
): Promise<{ processed: number; done: number; failed: number }> {
  const max = opts.max ?? Number.POSITIVE_INFINITY;
  await queue.recover();
  let processed = 0;
  let done = 0;
  let failed = 0;
  while (processed < max) {
    const job = await queue.claim({ leaseMs: opts.leaseMs });
    if (!job) break;
    processed++;
    try {
      const result = await handler(job);
      await queue.complete(job.id, result);
      done++;
    } catch (e) {
      const r = await queue.fail(job.id, (e as Error)?.message ?? String(e));
      if (!r.requeued) failed++;
    }
  }
  return { processed, done, failed };
}
