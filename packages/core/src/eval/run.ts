#!/usr/bin/env node
// src/eval/run.ts — eval kapısı. `npm run eval`
// Örnek korpusu bellek-içi indekse alır, eval setini koşar, raporu basar,
// kapı başarısızsa exit 1 (CI'da zorunlu kapı).

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PgliteEngine } from "../core/pglite-engine.js";
import { HashingEmbedder } from "../core/hashing-embedder.js";
import { MarkdownStore } from "../store/markdown-store.js";
import { runEval, renderReport } from "./eval.js";

const brainDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "brain");
const jsonOut = process.argv.includes("--json");

const engine = new PgliteEngine({ embedder: new HashingEmbedder() });
await engine.init();
for (const { node, edges } of new MarkdownStore(brainDir).readAll()) await engine.putNode(node, edges);

const report = await runEval(engine);
await engine.close();

console.log(jsonOut ? JSON.stringify(report, null, 2) : renderReport(report));
process.exit(report.ok ? 0 : 1);
