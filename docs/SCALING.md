# Scaling: PGLite → Postgres

Vitrus has **one storage interface** (`SqlDriver`) with two implementations. The same SQL, schema, and
engine run on both — `PostgresEngine extends PgliteEngine`. You prototype locally and promote to a
server without rewriting a single query.

| | PGLite | Postgres + pgvector |
| --- | --- | --- |
| Setup | none (WASM, on disk in `./.vitrus`) | a Postgres with the `vector` extension |
| Best for | personal, dev, CI, single-brain | teams, production, multi-tenant |
| Vector index | pgvector (WASM build) | pgvector (native, HNSW/IVFFlat) |
| Concurrency | single process | many clients |
| RLS | superuser → bypass (app-layer filter enforces) | `FORCE ROW LEVEL SECURITY`, non-superuser role |

## Promote to Postgres

```bash
bun add pg                                    # pg is an optional dependency
export VITRUS_PG_URL=postgres://user:pass@host:5432/vitrus
vitrus init --postgres                        # applies migrations 0001..0006
vitrus import ./brain                          # same command, now on Postgres
```

The index is disposable — re-importing on the new backend rebuilds everything from your markdown
(the source of truth).

## Production Postgres (Docker)

```yaml
# docker-compose.yml (excerpt)
services:
  db:
    image: pgvector/pgvector:pg17
    environment:
      POSTGRES_DB: vitrus
    ports: ["127.0.0.1:5432:5432"]    # bind localhost only
```

Run the app as a **non-superuser role** so row-level security is actually enforced (a superuser
bypasses RLS). Migrations `0005`/`0006` add the org-scoping policies.

## Migrations

`init()` applies migrations in order (`0001_init` … `0006`). Schema changes go through a migration;
optional field additions are safe, new required fields are breaking. The embedding dimension lives in
`0001_init.sql` and `core/types.ts` — keep them in sync.

## Job queue (background work)

Long-running sync/maintenance runs through a queue (BullMQ + Redis in the cloud layer). Job IDs are
sanitized (no `:`), so an org/connector pair becomes `org__connector`. `vitrus jobs` inspects state;
`vitrus dream` runs the maintenance loop (expire stale, refresh salience/entities).

## Multi-tenant isolation

When the engine is given an `org` context, node IDs are org-namespaced (`org~~slug`) and every read/
write is org-scoped at the index layer — the same slug across two orgs no longer collides. On Postgres,
RLS is a second, database-enforced layer. With no `org`, the engine is single-tenant/self-host
(unrestricted) — exactly what the open core uses. The cross-tenant leak test asserts org B sees
**zero** of org A's rows.
