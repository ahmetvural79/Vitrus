-- migrations/0004_jobs.sql
-- Dayanıklı iş kuyruğu (gbrain paritesi: "durable subagent execution + crash recovery").
-- Postgres-native (BullMQ tipi ayrı altyapı YOK) → PGLite ve Postgres+pgvector için AYNI SQL.
-- İki-fazlı kalıcılık: enqueue (queued) → claim (running + lease) → complete/fail.
-- Crash recovery: lease_until geçmiş 'running' iş yeniden talep edilebilir (işçi çöktü).

CREATE TABLE IF NOT EXISTS jobs (
  id            BIGSERIAL PRIMARY KEY,
  kind          TEXT NOT NULL,                       -- "think" | "enrich" | "agent" | ...
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','running','done','failed')),
  priority      INT  NOT NULL DEFAULT 0,             -- yüksek önce
  attempts      INT  NOT NULL DEFAULT 0,
  max_attempts  INT  NOT NULL DEFAULT 3,
  lease_until   TIMESTAMPTZ,                         -- running iş bu ana kadar "canlı"; geçince reclaim
  last_error    TEXT,
  result        JSONB,
  dedup_key     TEXT,                                -- idempotent enqueue (opsiyonel)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at       TIMESTAMPTZ
);

-- Claim taraması: aktif işler arasında öncelik+FIFO. (Bitmiş işler indeks dışı.)
CREATE INDEX IF NOT EXISTS jobs_claim_idx
  ON jobs (priority DESC, id ASC) WHERE status IN ('queued','running');

-- İdempotent enqueue: aynı dedup_key ile AKTİF iş tek (tamamlanınca yeniden kuyruğa girebilir).
CREATE UNIQUE INDEX IF NOT EXISTS jobs_dedup_uq
  ON jobs (dedup_key) WHERE dedup_key IS NOT NULL AND status IN ('queued','running');
