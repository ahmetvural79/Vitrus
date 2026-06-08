// src/core/sql-driver.ts
// SQL sürücü soyutlaması — "iki motor, tek SQL" deseni. PgliteEngine'in tüm SQL'i (şema +
// hibrit arama + bi-temporal + ACL + kuyruk) buradan geçer; sürücüyü değiştirmek motoru
// PGLite (kişisel/dev, WASM) ile Postgres+pgvector (paylaşımlı/ölçek) arasında taşır.
// AYNI migration SQL'i iki tarafta da çalışır (migrations/0001..0004 zaten "her ikisi için").

import type { PGlite } from "@electric-sql/pglite";

// Specifier'ı değişkende tut: tsc literal "pg"'yi statik çözmeye çalışmaz (pg optionalDependency,
// offline kurulu olmayabilir) → typecheck kapısı pg olmadan da yeşil. Runtime'da bun çözer.
const PG_MODULE = "pg";

/** Motorun ihtiyaç duyduğu asgari SQL yüzeyi. PGlite ve node-postgres ikisi de karşılar. */
export interface SqlDriver {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Çok-ifadeli (parametresiz) SQL — migration uygulamak için. */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

/** PGLite (WASM Postgres) sürücüsü — kişisel/dev/varsayılan. */
export class PgliteDriver implements SqlDriver {
  constructor(private readonly db: PGlite) {}
  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
    const r = await this.db.query<T>(sql, params as unknown[] | undefined);
    return { rows: r.rows };
  }
  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }
  async close(): Promise<void> {
    await this.db.close();
  }
}

/**
 * Postgres+pgvector sürücüsü (ölçek/paylaşım). `pg` paketini TEMBEL yükler — yalnız
 * gerçekten kullanılınca (--postgres / VITRUS_PG_URL). Böylece offline kapılar `pg`
 * kurulu olmadan da yeşil kalır. Çok-ifadeli migration'lar parametresiz `query` ile
 * (simple protocol) çalışır; pgvector eklentisi sunucuda kurulu olmalıdır.
 */
export class PgDriver implements SqlDriver {
  private poolPromise: Promise<{ query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>; end: () => Promise<void> }> | null = null;

  constructor(private readonly connectionString: string) {}

  private pool() {
    if (!this.poolPromise) {
      this.poolPromise = import(PG_MODULE)
        .then((mod: unknown) => {
          const pg = mod as { Pool?: new (cfg: unknown) => unknown; default?: { Pool?: new (cfg: unknown) => unknown } };
          const Pool = pg.Pool ?? pg.default?.Pool;
          if (!Pool) throw new Error("'pg' module has no Pool export");
          return new Pool({ connectionString: this.connectionString }) as {
            query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
            end: () => Promise<void>;
          };
        })
        .catch((e: unknown) => {
          throw new Error(
            `PgDriver: install 'pg' to use Postgres backend (bun add pg). ${(e as Error)?.message ?? e}`
          );
        });
    }
    return this.poolPromise;
  }

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
    const pool = await this.pool();
    const res = await pool.query(sql, params);
    return { rows: res.rows as T[] };
  }

  async exec(sql: string): Promise<void> {
    const pool = await this.pool();
    await pool.query(sql);
  }

  async close(): Promise<void> {
    if (this.poolPromise) {
      const pool = await this.poolPromise;
      await pool.end();
    }
  }
}
