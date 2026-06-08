// src/core/postgres-engine.ts
// Ölçekli/paylaşımlı backend: Postgres+pgvector. PgliteEngine'in TÜM SQL'ini miras alır
// (tek satır SQL kopyalanmaz) ve yalnız sürücüyü PgDriver ile değiştirir — "iki motor, tek SQL".
// Gereksinim: sunucuda `vector` (pgvector) eklentisi + `pg` paketi (optionalDependency, tembel).
// AYNI migration'lar (0001..0004) gerçek Postgres'te de geçerlidir (HNSW, tsvector, jsonb, dizi).

import { PgliteEngine } from "./pglite-engine.js";
import { PgDriver } from "./sql-driver.js";
import type { Embedder } from "./engine.js";
import type { Synthesizer } from "./synthesizer.js";
import type { Reranker } from "./reranker.js";
import { normalizeEnv } from "./env.js";

export class PostgresEngine extends PgliteEngine {
  constructor(opts: {
    connectionString: string;
    embedder: Embedder;
    synthesizer?: Synthesizer;
    reranker?: Reranker;
    /** Kiracı (org) bağlamı — çok-kiracılı bulutta her istek için set edilir. */
    org?: string;
  }) {
    super({
      embedder: opts.embedder,
      synthesizer: opts.synthesizer,
      reranker: opts.reranker,
      driver: new PgDriver(opts.connectionString),
      org: opts.org,
    });
  }
}

export interface EngineEnvOpts {
  dataDir?: string;
  embedder: Embedder;
  synthesizer?: Synthesizer;
  reranker?: Reranker;
}

/**
 * Ortamdan backend seç: VITRUS_PG_URL / DATABASE_URL varsa Postgres (ölçek/paylaşım),
 * yoksa PGLite (kişisel/dev, sıfır-kurulum). CLI bunu kullanır; --postgres bayrağı env'i ezer.
 */
export function engineFromEnv(opts: EngineEnvOpts, rawEnv: Record<string, string | undefined> = process.env): PgliteEngine {
  const env = normalizeEnv(rawEnv);
  const pgUrl = env.VITRUS_PG_URL ?? env.DATABASE_URL;
  if (pgUrl) {
    return new PostgresEngine({
      connectionString: pgUrl,
      embedder: opts.embedder,
      synthesizer: opts.synthesizer,
      reranker: opts.reranker,
    });
  }
  return new PgliteEngine(opts);
}
