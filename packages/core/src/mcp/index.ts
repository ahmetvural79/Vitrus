#!/usr/bin/env bun
// src/mcp/index.ts — vitrus-mcp bin. Vitrus beynini MCP üzerinden sunar.
//   vitrus-mcp              # stdio (Claude Code/Cursor bunu çağırır)
//   vitrus-mcp --http 3000  # Streamable HTTP :3000/mcp
// Veri dizini: VITRUS_DATA (varsayılan ./.vitrus). Önce `vitrus import`.

import { embedderFromEnv } from "../core/openai-embedder.js";
import { synthesizerFromEnv } from "../core/llm-synthesizer.js";
import { rerankerFromEnv } from "../core/reranker.js";
import { engineFromEnv } from "../core/postgres-engine.js";
import { runStdio, runHttp } from "./server.js";
import { verifierFromEnv } from "./auth.js";
import { MarkdownStore } from "../store/markdown-store.js";
import { normalizeEnv } from "../core/env.js";

const ENV = normalizeEnv(process.env); // eski GLASSBOX_*/LUCIDEX_* adlarını da kabul et
const DATA_DIR = ENV.VITRUS_DATA ?? "./.vitrus";
const argv = process.argv.slice(2);
const httpIdx = argv.indexOf("--http");
const port = httpIdx >= 0 ? Number(argv[httpIdx + 1] ?? 3000) : null;

// Üretim-parite: backend + embedder/synth/reranker env'den (anahtarsız → offline default).
const engine = engineFromEnv({
  dataDir: DATA_DIR,
  embedder: embedderFromEnv(),
  synthesizer: synthesizerFromEnv(),
  reranker: rerankerFromEnv(),
});
await engine.init();

// Ajan-yazma sahipliği: VITRUS_BRAIN verilirse remember/forget/improve markdown
// KAYNAĞINA yazar (reindex'te kalır). Verilmezse index-only (uyarı ile).
const store = ENV.VITRUS_BRAIN ? new MarkdownStore(ENV.VITRUS_BRAIN) : undefined;

if (port !== null && !Number.isNaN(port)) {
  // OAuth: VITRUS_AUTH_TOKENS="tok:alice,..." verilirse Resource Server modu.
  const resource = ENV.VITRUS_RESOURCE ?? `http://localhost:${port}/mcp`;
  const verifier = verifierFromEnv(resource, ENV.VITRUS_AUTH_TOKENS) ?? undefined;
  const authServers = (ENV.VITRUS_AUTH_SERVERS ?? "").split(",").filter(Boolean);
  await runHttp(engine, port, { verifier, resource, authServers, store });
  console.error(
    `Vitrus MCP (Streamable HTTP) → http://localhost:${port}/mcp · ${verifier ? "OAuth korumalı" : "açık (dev)"}`
  );
} else {
  console.error("Vitrus MCP (stdio) hazır.");
  await runStdio(engine, store);
}
