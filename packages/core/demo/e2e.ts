// demo/e2e.ts — T13 uçtan uca demo (glass-box demosu).
// Bir AJAN (burada MCP client; gerçekte Claude Code) vitrus-mcp'ye stdio ile
// bağlanır ve gerçek bir görevi YÜRÜTÜR: "Yeni on-call mühendisi: incident nasıl çözülür?"
//   ingest → MCP bağlan → search → think (kaynak+boşluk) → provenance → skill_export
// + TUTARLILIK: skill_export iki kez → birebir aynı (deterministik motor).
//
// Çalıştır: npm run demo

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import { MarkdownStore } from "../src/store/markdown-store.js";

const here = dirname(fileURLToPath(import.meta.url));
const brainDir = join(here, "..", "brain");
const TASK = "incident nasıl çözülür";

function hr(t: string) {
  console.log("\n" + "─".repeat(64) + "\n" + t);
}

const work = mkdtempSync(join(tmpdir(), "vitrus-demo-"));
const dataDir = join(work, "data");

try {
  // 1) Beyni kur (kaynak-üstü markdown → türev indeks).
  hr("1 · INGEST — sample company corpus → brain");
  const eng = new PgliteEngine({ dataDir, embedder: new HashingEmbedder() });
  await eng.init();
  let n = 0;
  for (const { node, edges } of new MarkdownStore(brainDir).readAll()) {
    await eng.putNode(node, edges);
    n++;
  }
  await eng.close();
  console.log(`  ${n} nodes imported → ${dataDir}`);

  // 2) Ajan MCP ile bağlanır (Claude Code'un yaptığının birebir aynısı).
  hr("2 · CONNECT — agent connects to vitrus-mcp (stdio)");
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/mcp/index.ts"],
    env: { ...process.env, VITRUS_DATA: dataDir } as Record<string, string>,
  });
  const agent = new Client({ name: "on-call-agent", version: "0" });
  await agent.connect(transport);
  const tools = await agent.listTools();
  console.log(`  connected · tools: ${tools.tools.map((t) => t.name).join(", ")}`);

  console.log(`\n  TASK: "${TASK}" (new on-call engineer)`);

  // 3) search
  hr("3 · SEARCH — retrieve relevant sources");
  const s = (await agent.callTool({ name: "search", arguments: { query: TASK, limit: 5 } }))
    .structuredContent as { hits: { slug: string; score: number }[] };
  for (const h of s.hits) console.log(`  ${h.score.toFixed(4)}  ${h.slug}`);

  // 4) think → görünürlük yüzeyi
  hr("4 · THINK — sourced answer + gaps + confidence");
  const surf = (await agent.callTool({ name: "think", arguments: { query: TASK } }))
    .structuredContent as any;
  console.log(surf.answer);
  console.log("\n  ⚠ What the brain doesn't know:");
  for (const g of surf.gaps) console.log(`    [${g.kind}] ${g.message}`);
  const c = surf.cards;
  console.log(
    `\n  ┌ sources: ${c.sources} · open gaps: ${c.openGaps} · oldest: ${c.oldestSourceDays}d · confidence: ${Math.round(
      c.confidence * 100
    )}% ┐`
  );

  // 5) provenance — bir iddianın kaynağını doğrula + git-Markdown'a çöz
  hr("5 · PROVENANCE — 'where did this come from?'");
  const slug = surf.sources[0]?.slug ?? "durable/policies/incident-response";
  const prov = (await agent.callTool({ name: "provenance", arguments: { slug } }))
    .structuredContent as any;
  console.log(`  ${slug} · connector=${prov.connector ?? "-"} · uri=${prov.uri ?? "-"}`);
  const res = await agent.readResource({ uri: `vitrus://node/${slug}` });
  console.log(`  resource resolved → ${String((res.contents[0] as any).text).slice(0, 56).replace(/\n/g, " ")}…`);

  // 6) skill_export — çalıştırılabilir SKILL.md + TUTARLILIK
  hr("6 · SKILL_EXPORT — turn the workflow into an executable Agent Skill");
  const e1 = (await agent.callTool({ name: "skill_export", arguments: { topic: TASK } }))
    .structuredContent as any;
  const e2 = (await agent.callTool({ name: "skill_export", arguments: { topic: TASK } }))
    .structuredContent as any;
  console.log(`  name: ${e1.name} · valid: ${e1.valid} · files: ${e1.files.join(", ")}`);
  console.log(`  CONSISTENCY (2 runs identical?): ${e1.skillMd === e2.skillMd ? "✓ YES (deterministic)" : "✗ NO"}`);

  await agent.close();

  hr("✓ DEMO DONE — record → engine → trust surface → agent-native output, over MCP");
} finally {
  rmSync(work, { recursive: true, force: true });
}
