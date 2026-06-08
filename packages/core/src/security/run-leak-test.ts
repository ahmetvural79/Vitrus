#!/usr/bin/env node
// src/security/run-leak-test.ts — sızıntı kapısı. `npm run leak-test`
// Örnek korpusu bellek-içi indekse alır, harness'ı koşar, raporlar,
// TEK sızıntıda exit 1 (CI'da istisnasız zorunlu kapı).

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PgliteEngine } from "../core/pglite-engine.js";
import { HashingEmbedder } from "../core/hashing-embedder.js";
import { MarkdownStore } from "../store/markdown-store.js";
import { runLeakTest, renderLeakReport } from "./leak-test.js";

const brainDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "brain");
const store = new MarkdownStore(brainDir);

const engine = new PgliteEngine({ embedder: new HashingEmbedder() });
await engine.init();
for (const { node, edges } of store.readAll()) await engine.putNode(node, edges);

const report = await runLeakTest(engine, store);
await engine.close();

console.log(renderLeakReport(report));
process.exit(report.ok ? 0 : 1);
