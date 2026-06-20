#!/usr/bin/env bun
// src/cli/index.ts
// Vitrus CLI. Faz 0 hedefi: init / import / sync / search / think çalışsın.
// `sync` depo → sidecar (kaynak-üstü graf) yazar; motor retrieval'ı sonraki tasklar.

import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PgliteEngine } from "../core/pglite-engine.js";
import { MarkdownStore } from "../store/markdown-store.js";
import { embedderFromEnv } from "../core/openai-embedder.js";
import { synthesizerFromEnv } from "../core/llm-synthesizer.js";
import { rerankerFromEnv } from "../core/reranker.js";
import { workOff, type Job } from "../core/job-queue.js";
import { engineFromEnv } from "../core/postgres-engine.js";
import { buildSurface, renderSurfaceText, renderSurfaceHtml } from "../surface/surface.js";
import { formatExplain } from "../search/explain.js";
import { buildSkillPack, skillPackToBundle } from "../skill/skill-export.js";
import { validateSkillFile, skillFileToMarkdown } from "../skill/skill-file.js";
import { runSkillEval, renderSkillEvalReport, parseSkillEval } from "../skill/skill-eval.js";
import { skillifyCandidates, findStaleSkills, loadSkillRefs, renderCuration } from "../maintenance/skill-curator.js";
import { optimizeSkill, renderOptimize } from "../skill/skill-optimize.js";
import { ingest } from "../connectors/ingest.js";
import { SlackConnector } from "../connectors/slack.js";
import { GitHubConnector } from "../connectors/github.js";
import type { SyncPayload } from "../connectors/sync.js";
import { DocsConnector } from "../connectors/docs.js";
import { SessionConnector } from "../connectors/sessions.js";
import { EmailConnector } from "../connectors/email.js";
import { CalendarConnector } from "../connectors/calendar.js";
import { InboxConnector, captureRecord } from "../connectors/inbox.js";
import { RestConnector } from "../connectors/rest.js";
import { recordToNode } from "../connectors/types.js";
import { ChangeQueue, parseWebhook } from "../connectors/webhook.js";
import { resolveConfig, renderConfig } from "../core/config.js";
import { buildDashboard, renderDashboardHtml } from "../api/dashboard.js";
import { hooksFor, type AgentKind } from "./hooks.js";
import { normalizeEnv } from "../core/env.js";

// Eski GLASSBOX_*/LUCIDEX_* env adlarını da kabul et (marka geçişi geriye-uyumu).
const ENV = normalizeEnv(process.env);

// Embedder: multilingual OpenAIEmbedder when OPENAI_API_KEY is set (cross-lingual
// retrieval), else the offline-deterministic HashingEmbedder. The brain is
// content-language-agnostic; this is where cross-lingual capability plugs in.
const embedder = embedderFromEnv();
// Kalıcı dev veri dizini — CLI çağrıları arasında türev indeks korunur.
const DATA_DIR = ENV.VITRUS_DATA ?? "./.vitrus";

/** stdin'i tümüyle oku (pipe). TTY ise boş döner (interaktif → asılma yok). */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  // Bayrakları ayıkla: --html <dosya>, --json
  let htmlOut: string | null = null;
  const htmlIdx = rest.indexOf("--html");
  if (htmlIdx >= 0) {
    htmlOut = rest[htmlIdx + 1] ?? "surface.html";
    rest.splice(htmlIdx, htmlOut === rest[htmlIdx + 1] ? 2 : 1);
  }
  const jsonFlag = rest.includes("--json");
  if (jsonFlag) rest.splice(rest.indexOf("--json"), 1);

  let outDir = "./brain/derived/skills";
  const outIdx = rest.indexOf("--out");
  if (outIdx >= 0 && rest[outIdx + 1]) {
    outDir = rest[outIdx + 1];
    rest.splice(outIdx, 2);
  }
  const publishFlag = rest.includes("--publish");
  if (publishFlag) rest.splice(rest.indexOf("--publish"), 1);
  const evalFlag = rest.includes("--eval");
  if (evalFlag) rest.splice(rest.indexOf("--eval"), 1);
  const applyFlag = rest.includes("--apply");
  if (applyFlag) rest.splice(rest.indexOf("--apply"), 1);
  const graphFlag = rest.includes("--graph");
  if (graphFlag) rest.splice(rest.indexOf("--graph"), 1);
  // --explain: search sonuçlarının altına skor faktör dökümünü bas (atıf/debug).
  const explainFlag = rest.includes("--explain");
  if (explainFlag) rest.splice(rest.indexOf("--explain"), 1);

  let httpPort: number | null = null;
  const httpFlagIdx = rest.indexOf("--http");
  if (httpFlagIdx >= 0) {
    const maybe = Number(rest[httpFlagIdx + 1]);
    httpPort = Number.isNaN(maybe) ? 3000 : maybe;
    rest.splice(httpFlagIdx, Number.isNaN(maybe) ? 1 : 2);
  }

  // --as <principal>: sorguyu bu kullanıcı gözünden çalıştır (ACL uygulanır)
  let asUser: string | null = null;
  const asIdx = rest.indexOf("--as");
  if (asIdx >= 0 && rest[asIdx + 1]) {
    asUser = rest[asIdx + 1];
    rest.splice(asIdx, 2);
  }

  // --asof <ISO>: bi-temporal zaman-yolculuğu — grafı o tarihteki haliyle göster.
  let asofArg: string | null = null;
  const asofIdx = rest.indexOf("--asof");
  if (asofIdx >= 0 && rest[asofIdx + 1]) {
    asofArg = rest[asofIdx + 1];
    rest.splice(asofIdx, 2);
  }

  // --scope <x>: B2 — retrieval'ı bu kapsama daralt / ingest'i bu kapsamla etiketle.
  let scopeArg: string | null = null;
  const scopeIdx = rest.indexOf("--scope");
  if (scopeIdx >= 0 && rest[scopeIdx + 1]) {
    scopeArg = rest[scopeIdx + 1];
    rest.splice(scopeIdx, 2);
  }

  // --postgres <url>: ölçekli Postgres+pgvector backend (yoksa VITRUS_PG_URL/DATABASE_URL env).
  let pgUrl: string | null = null;
  const pgIdx = rest.indexOf("--postgres");
  if (pgIdx >= 0) {
    pgUrl = rest[pgIdx + 1] ?? null;
    rest.splice(pgIdx, pgUrl ? 2 : 1);
  }

  const arg = rest.join(" "); // çok-kelimeli sorgu/dizin (tırnak gerekmesin)
  // Backend env'den seçilir: VITRUS_PG_URL/DATABASE_URL → Postgres, yoksa PGLite.
  // --postgres <url> env'i ezer. Embedder/synth/reranker da env-güdümlü (sağlayıcı bağımsız).
  const engine = engineFromEnv(
    { dataDir: DATA_DIR, embedder, synthesizer: synthesizerFromEnv(), reranker: rerankerFromEnv() },
    pgUrl ? { ...process.env, VITRUS_PG_URL: pgUrl } : process.env
  );

  switch (cmd) {
    case "init":
      await engine.init();
      console.log("brain initialized.");
      break;

    case "import": {
      const dir = arg || "./brain";
      await engine.init();
      const store = new MarkdownStore(dir);
      const all = store.readAll();
      for (const { node, edges, relPath } of all) {
        await engine.putNode(node, edges);
        store.writeSidecar(relPath, edges); // graf git'te kalıcı
        console.log(`  + ${node.slug} (${node.type}, ${node.tier}) · ${edges.length} edges`);
      }
      await engine.refreshEntities();
      await engine.refreshSalience();
      const totalEdges = all.reduce((n, x) => n + x.edges.length, 0);
      console.log(`${all.length} nodes imported, ${totalEdges} typed edges (sidecar written).`);
      break;
    }

    case "import-obsidian": {
      // Obsidian vault → Vitrus: .md'leri oku, frontmatter + [[wikilink]] çevir, ingest (namespace working/obsidian/).
      const dir = arg || "./vault";
      if (!existsSync(dir)) { console.log(`vault not found: ${dir}`); break; }
      await engine.init();
      const { ObsidianConnector } = await import("../connectors/obsidian.js");
      const files: { path: string; content: string }[] = [];
      const walk = (d: string, rel: string) => {
        for (const ent of readdirSync(d, { withFileTypes: true })) {
          if (ent.name.startsWith(".")) continue; // .obsidian, .trash vb. atla
          const r = rel ? `${rel}/${ent.name}` : ent.name;
          if (ent.isDirectory()) walk(join(d, ent.name), r);
          else if (ent.name.toLowerCase().endsWith(".md")) files.push({ path: r, content: readFileSync(join(d, ent.name), "utf8") });
        }
      };
      walk(dir, "");
      if (files.length === 0) { console.log(`no .md files under ${dir}`); break; }
      const conn = new ObsidianConnector(files, { now: new Date().toISOString() });
      const r = await ingest(engine, conn);
      await engine.refreshEntities();
      await engine.refreshSalience();
      console.log(`Obsidian import: ${files.length} file → ${r.upserted} node (namespace ${conn.slugPrefix}). [[link]]'ler mentions kenarına çözüldü.`);
      break;
    }

    case "sync": {
      // Yalnız kaynak-üstü senkron: depo → sidecar (indeks dokunmadan).
      const dir = arg || "./brain";
      const store = new MarkdownStore(dir);
      const { files, edges } = store.rebuildSidecars();
      console.log(`${files} files scanned, ${edges} edges written to sidecar.`);
      break;
    }

    case "search": {
      const principals = asUser ? await engine.expandPrincipals(asUser) : undefined;
      if (asUser) console.log(`(as ${asUser} · principals: ${principals!.join(", ")})`);
      // Yetkili (--as) sorgu audit'e yazılır.
      const hits = await engine.search(arg ?? "", { limit: 10, principals, audit: !!asUser, scope: scopeArg ?? undefined });
      for (const h of hits) {
        const cos = h.boosts?.cosine !== undefined ? ` cos=${h.boosts.cosine}` : "";
        const rr = h.boosts?.rerank !== undefined ? ` rr=${h.boosts.rerank}` : "";
        const ranks = `v=${h.vectorRank ?? "-"} b=${h.bm25Rank ?? "-"} e=${h.entityRank ?? "-"}`;
        console.log(`  ${h.score.toFixed(4)}  ${h.node.slug}  [${ranks}${cos}${rr}]`);
        if (explainFlag) console.log(formatExplain(h));
      }
      if (hits.length === 0) console.log("(no results — first run: vitrus import <dir>)");
      break;
    }

    case "think": {
      const principals = asUser ? await engine.expandPrincipals(asUser) : undefined;
      const r = await engine.think(arg, { principals, scope: scopeArg ?? undefined });
      const surface = buildSurface(arg, r);
      if (jsonFlag) {
        console.log(JSON.stringify(surface, null, 2));
      } else {
        console.log(renderSurfaceText(surface));
      }
      if (htmlOut) {
        writeFileSync(htmlOut, renderSurfaceHtml(surface));
        console.log(`\nHTML visibility surface written: ${htmlOut}`);
      }
      break;
    }

    case "verify": {
      // D1 — "asla self-report'a güvenme": iddiayı deterministik doğrula (kaynaklı/çelişik/bayat).
      const { verifyClaim, renderVerify } = await import("../verify/verify.js");
      const principals = asUser ? await engine.expandPrincipals(asUser) : undefined;
      console.log(renderVerify(await verifyClaim(engine, arg, { principals })));
      break;
    }

    case "gaps": {
      const gaps = await engine.findGaps();
      if (gaps.length === 0) {
        console.log("no gaps found (first run: vitrus import <dir>).");
        break;
      }
      console.log(`⚠ Corpus gaps (${gaps.length}):`);
      for (const g of gaps) console.log(`  [${g.kind}] ${g.message}`);
      break;
    }

    case "schema": {
      // M3.7 — şema paketi (vitrus-base): tip taksonomisini denetle/açıkla.
      // usage: vitrus schema [lint] | vitrus schema explain <type>
      const { VITRUS_BASE_PACK, schemaLint, explainType } = await import("../schema/index.js");
      const sub = rest[0] ?? "lint";
      if (sub === "explain") {
        const ex = explainType(VITRUS_BASE_PACK, rest[1] ?? "");
        if (!ex) { console.log(`unknown type: ${rest[1] ?? ""} (try a NodeType e.g. person, or EdgeType e.g. works_at)`); break; }
        console.log(`${ex.kind === "node" ? "◆" : "↔"} ${ex.name} (${ex.kind}) — ${ex.description}`);
        if (ex.kind === "node") {
          if (ex.slugPattern || ex.tierHint) console.log(`  ${ex.slugPattern ?? ""}${ex.tierHint ? `  ·  tier: ${ex.tierHint}` : ""}`.trim());
          if (ex.edgesAsFrom?.length) console.log("  as source: " + ex.edgesAsFrom.map((e) => `${e.type}→${e.to.join("/")}`).join(", "));
          if (ex.edgesAsTo?.length) console.log("  as target: " + ex.edgesAsTo.map((e) => `${e.from.join("/")}→${e.type}`).join(", "));
        } else {
          console.log(`  ${ex.from?.join("/")} → ${ex.to?.join("/")}`);
          if (ex.inferredVerbs?.length) console.log("  verb hints: " + ex.inferredVerbs.join(", "));
        }
        break;
      }
      await engine.init();
      const r = await schemaLint(engine, VITRUS_BASE_PACK);
      if (r.findings.length === 0) {
        console.log(`✓ Schema clean (${r.scannedNodes} nodes, ${r.scannedEdges} edges — ${r.pack}).`);
      } else {
        console.log(`⚠ ${r.findings.length} schema finding(s) (${r.pack}):`);
        for (const f of r.findings) console.log(`  [${f.kind}] ${f.message}`);
        if (r.truncated) console.log(`  (${r.truncated} nodes not scanned — raise the limit)`);
      }
      break;
    }

    case "ops": {
      // Operasyonel verimsizlik haritası (deterministik): unowned/bus_factor/bottleneck/broken_handoff.
      const findings = await engine.findOps();
      if (findings.length === 0) {
        console.log("✓ no operational inefficiencies detected.");
        break;
      }
      console.log(`⚠ Operational findings (${findings.length}, severity-ranked):`);
      for (const f of findings) console.log(`  [${f.severity}] ${f.kind}: ${f.message}`);
      break;
    }

    case "conflicts": {
      // "Kaynaklar çeliştiğinde Vitrus söyler" — çelişkiler çift-taraflı + çözüm durumuyla.
      const conflicts = await engine.findConflicts();
      if (conflicts.length === 0) {
        console.log("✓ no conflicts — your sources agree.");
        break;
      }
      const open = conflicts.filter((c) => !c.resolved).length;
      console.log(`⚠ Conflicts (${conflicts.length}; ${open} open):`);
      for (const c of conflicts) console.log(`  ${c.resolved ? "✓ resolved" : "⚠ OPEN    "} "${c.a.slug}" ⇄ "${c.b.slug}" (${c.kind})`);
      if (open) console.log(`\nResolve: vitrus resolve <keep-slug> <supersede-slug>`);
      break;
    }

    case "resolve": {
      // Çelişkiyi çöz: kazananı tut, kaybedeni supersede et (resolve_conflict aracıyla aynı motor).
      const [keep, supersede] = rest;
      if (!keep || !supersede) {
        console.log("usage: vitrus resolve <keep-slug> <supersede-slug> [--as <user>]");
        break;
      }
      await engine.init();
      const brainDir = ENV.VITRUS_BRAIN;
      const store = brainDir ? new MarkdownStore(brainDir) : undefined;
      const principals = asUser ? await engine.expandPrincipals(asUser) : undefined;
      const { callTool } = await import("../mcp/tools.js");
      const r = await callTool(engine, "resolve_conflict", { keep, supersede }, { store, principals });
      const out = r.structuredContent as { resolved: boolean; keep?: string; superseded?: string };
      console.log(out.resolved ? `✓ resolved: "${out.keep}" supersedes "${out.superseded}" (now stale)` : `could not resolve: "${keep}" not accessible or not found`);
      break;
    }

    case "attention":
    case "watch": {
      // Proaktif "dikkatini bekleyenler" (v1). CLI app katmanı → gerçek saat now olarak geçilir.
      const items = await engine.attention(new Date().toISOString());
      if (items.length === 0) {
        console.log("nothing needs attention right now ✓");
        break;
      }
      console.log(`🔔 Needs attention (${items.length}):`);
      for (const it of items) console.log(`  [${it.severity}] ${it.kind} · ${it.message}`);
      break;
    }

    case "skills": {
      // Prebuilt skill kütüphanesi (M3.4): ajana Vitrus'u kullanmayı öğreten curated SKILL.md'ler.
      // usage: vitrus skills [list | show <name> | install [--out <dir>]]
      const { PREBUILT_SKILLS, findPrebuiltSkill } = await import("../skill/prebuilt.js");
      const { skillToBundle } = await import("../skill/skill-export.js");
      const { skillFileToMarkdown, validateSkillFile } = await import("../skill/skill-file.js");
      const sub = rest[0] ?? "list";
      if (sub === "show") {
        const s = findPrebuiltSkill(rest[1] ?? "");
        if (!s) { console.log(`unknown skill: ${rest[1] ?? ""} (try: vitrus skills list)`); break; }
        console.log(skillFileToMarkdown(s));
        break;
      }
      if (sub === "install") {
        const dir = outDir === "./brain/derived/skills" ? "./.claude/skills" : outDir; // --out verilmediyse Claude Code dizini
        let wrote = 0;
        for (const s of PREBUILT_SKILLS) {
          const v = validateSkillFile(s);
          if (!v.ok) { console.log(`✗ ${s.name}: ${v.errors.join("; ")}`); continue; }
          for (const f of skillToBundle(s).files) {
            const p = join(dir, f.path); // f.path zaten "<name>/SKILL.md" — çift-iç-içe yapma
            mkdirSync(dirname(p), { recursive: true });
            writeFileSync(p, f.content);
          }
          wrote++;
        }
        console.log(`✓ installed ${wrote}/${PREBUILT_SKILLS.length} prebuilt skills → ${dir}`);
        break;
      }
      console.log(`Prebuilt skills (${PREBUILT_SKILLS.length}):`);
      for (const s of PREBUILT_SKILLS) console.log(`  ${s.name.padEnd(22)} ${s.description.slice(0, 76)}`);
      console.log("\n  vitrus skills show <name>            print one SKILL.md");
      console.log("  vitrus skills install [--out <dir>]  write bundles (default ./.claude/skills)");
      break;
    }

    case "skill": {
      // think → skill PACK (SKILL.md + reference/ + otomatik eval). Motor sözleşmesi
      // bozulmadan: pack CLI/kütüphane katmanında think() çıktısından kurulur.
      const r = await engine.think(arg);
      const pack = buildSkillPack(arg, r);
      const v = validateSkillFile(pack.skill);
      const bundle = skillPackToBundle(pack);

      // --eval: yalnız eval raporu (yayınlama yok) — donmuş beklentiyi canlı beyne karşı koş.
      if (evalFlag) {
        const report = await runSkillEval(engine, pack.eval);
        console.log(renderSkillEvalReport(report));
        process.exit(report.ok ? 0 : 1);
      }

      if (!publishFlag) {
        // ÖNİZLEME (insan-onaylı yayınlamadan önce). SKILL.md'yi göster.
        console.log(skillFileToMarkdown(pack.skill));
        console.log(`\n--- bundle files (${bundle.files.length}) ---`);
        for (const f of bundle.files) console.log(`  ${f.path}`);
        console.log(v.ok ? "\n✓ valid Agent Skill (SKILL.md)" : `\n✗ invalid:\n  - ${v.errors.join("\n  - ")}`);
        console.log(`\nto publish: vitrus skill "${arg}" --publish [--out <dir>]`);
        console.log(`to see the eval:  vitrus skill "${arg}" --eval`);
        break;
      }

      if (!v.ok) {
        console.error(`✗ invalid skill, not published:\n  - ${v.errors.join("\n  - ")}`);
        process.exit(1);
      }
      // KAPI: skill kendi eval'ini geçmeden yayınlanmaz ("skill pack'in testi var").
      const report = await runSkillEval(engine, pack.eval);
      if (!report.ok) {
        console.error("✗ skill failed its own eval, not published:\n");
        console.error(renderSkillEvalReport(report));
        process.exit(1);
      }
      for (const f of bundle.files) {
        const target = join(outDir, f.path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, f.content);
        console.log(`  + ${target}`);
      }
      console.log(`\n✓ published → ${join(outDir, bundle.name)} · eval passed · review and commit (human approval).`);
      break;
    }

    case "skill-eval": {
      // Kaydedilmiş bir skill paketinin DONMUŞ eval'ini GÜNCEL beyne karşı koşar.
      // "if it forgets, it becomes a test case failure" → regresyon yakalama.
      const specPath = join(outDir, arg, "eval", "skill.eval.json");
      let spec;
      try {
        spec = parseSkillEval(readFileSync(specPath, "utf8"));
      } catch {
        console.error(`✗ eval spec not found: ${specPath}\n  first: vitrus skill "<topic>" --publish`);
        process.exit(1);
      }
      const report = await runSkillEval(engine, spec);
      console.log(renderSkillEvalReport(report));
      process.exit(report.ok ? 0 : 1);
    }

    case "skill-curate": {
      // A2 — repeated-query skillify candidates + stale published skills (deterministic).
      await engine.init();
      const skills = loadSkillRefs(outDir);
      const audit = await engine.getAudit();
      console.log(
        renderCuration({
          skillifyCandidates: skillifyCandidates(audit),
          staleSkills: await findStaleSkills(engine, skills),
        })
      );
      break;
    }

    case "skill-optimize": {
      // A3 — run the frozen eval against the current brain; if it fails, diagnose +
      // regenerate a fresh pack (body + auto-generated benchmark). --apply writes it.
      const specPath = join(outDir, arg, "eval", "skill.eval.json");
      let spec;
      try {
        spec = parseSkillEval(readFileSync(specPath, "utf8"));
      } catch {
        console.error(`✗ eval spec not found: ${specPath}\n  first: vitrus skill "<topic>" --publish`);
        process.exit(1);
      }
      const result = await optimizeSkill(engine, spec);
      console.log(renderOptimize(result));
      if (!result.refreshed) break;
      if (!applyFlag) {
        console.log(`\nto apply: vitrus skill-optimize ${arg} --apply [--out <dir>]`);
        break;
      }
      // GATE: the refreshed pack must pass its own (fresh) eval before writing.
      const recheck = await runSkillEval(engine, result.refreshed.eval);
      if (!recheck.ok) {
        console.error("✗ refreshed pack still fails its eval, not written:\n");
        console.error(renderSkillEvalReport(recheck));
        process.exit(1);
      }
      const bundle = skillPackToBundle(result.refreshed);
      for (const f of bundle.files) {
        const target = join(outDir, f.path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, f.content);
        console.log(`  + ${target}`);
      }
      console.log(`\n✓ optimized → ${join(outDir, bundle.name)} · review and commit (human approval).`);
      break;
    }

    case "ingest": {
      // vitrus ingest <slack|github|...> <fixture.json>
      //   CANLI: vitrus ingest github --live --repo owner/name [--token <t>|env GITHUB_TOKEN] [--since <iso>] [--max-pages N]
      await engine.init();
      const [kind, fixture] = rest;

      // Generic REST connector (M1 Faz A — Image #1'in motoru): vitrus ingest rest --config <config.json>
      if (kind === "rest") {
        const cfgIdx = rest.indexOf("--config");
        const cfgPath = cfgIdx >= 0 ? rest[cfgIdx + 1] : undefined;
        if (!cfgPath) {
          console.log("usage: vitrus ingest rest --config <config.json> [--as <owner>] [--scope <x>]");
          break;
        }
        const config = JSON.parse(readFileSync(cfgPath, "utf8"));
        const conn = new RestConnector(config, { now: new Date().toISOString(), owner: asUser ?? undefined, scope: scopeArg ?? undefined });
        const r = await ingest(engine, conn);
        await engine.refreshEntities();
        await engine.refreshSalience();
        console.log(`${r.connector}: ${r.upserted} records imported, ${r.pruned} pruned.`);
        break;
      }

      if (rest.includes("--live")) {
        const takeOne = (flag: string): string | undefined => {
          const i = rest.indexOf(flag);
          return i >= 0 && rest[i + 1] ? rest[i + 1] : undefined;
        };
        const since = takeOne("--since");
        const maxPagesArg = takeOne("--max-pages");
        const maxPages = maxPagesArg ? Number(maxPagesArg) : undefined;
        const queueMode = rest.includes("--queue"); // inline yerine dayanıklı sync işi kuyruğa al
        const tokenArg = takeOne("--token");

        const LIVE_SOURCES = new Set(["github", "slack", "notion", "linear", "jira", "drive", "gmail"]);
        if (!LIVE_SOURCES.has(kind)) {
          console.log("live ingest supports: github | slack | notion | linear | jira | drive | gmail");
          break;
        }

        // payload (kaynak-spesifik) — queue ve inline aynı payload'ı kullanır.
        let payload: SyncPayload;
        if (kind === "github") {
          const repo = takeOne("--repo");
          if (!repo) {
            console.log("usage: vitrus ingest github --live --repo owner/name [--token <t>|env GITHUB_TOKEN] [--since <iso>] [--queue]");
            break;
          }
          payload = { source: "github", repo, since, maxPages };
        } else if (kind === "slack") {
          const channel = takeOne("--channel");
          if (!channel) {
            console.log("usage: vitrus ingest slack --live --channel <Cxxxx> [--name <ch>] [--token <t>|env SLACK_TOKEN] [--since <iso>] [--queue]");
            break;
          }
          payload = { source: "slack", channel, channelName: takeOne("--name"), since, maxPages };
        } else if (kind === "jira") {
          const site = takeOne("--site");
          const email = takeOne("--email");
          if (!site || !email) {
            console.log("usage: vitrus ingest jira --live --site <co|url> --email <e> [--token <t>|env JIRA_API_TOKEN] [--since <iso>] [--queue]");
            break;
          }
          payload = { source: "jira", site, email, since, maxPages };
        } else {
          // notion | linear | drive | gmail — workspace geneli (ek konum argümanı yok).
          payload = { source: kind as "notion" | "linear" | "drive" | "gmail", since, maxPages };
        }

        if (queueMode) {
          // Dayanıklı sync işi (token taşımaz; worker env'den okur). Aynı kaynak → tek aktif iş.
          const { syncDedupKey } = await import("../connectors/sync.js");
          const { id, deduped } = await engine.getQueue().enqueue("sync", payload as unknown as Record<string, unknown>, { dedupKey: syncDedupKey(payload) });
          console.log(deduped ? `sync already queued (#${id})` : `enqueued sync job #${id} (${kind}) · run worker: vitrus agent work`);
          break;
        }

        // inline: buildConnector (queue ile AYNI kurulum) — token env'den veya --token.
        const { buildConnector } = await import("../connectors/sync.js");
        const TOKEN_ENV: Record<string, string> = { github: "GITHUB_TOKEN", slack: "SLACK_TOKEN", notion: "NOTION_TOKEN", linear: "LINEAR_API_KEY", jira: "JIRA_API_TOKEN", drive: "GOOGLE_TOKEN", gmail: "GOOGLE_TOKEN" };
        const buildEnv = tokenArg ? { ...ENV, [TOKEN_ENV[kind]]: tokenArg } : ENV;
        let conn;
        try {
          conn = buildConnector(payload, buildEnv);
        } catch (e) {
          console.log((e as Error).message);
          break;
        }
        const r = await ingest(engine, conn, { prune: !since }); // delta (since) → prune kapalı
        await engine.refreshEntities();
        await engine.refreshSalience();
        console.log(`${r.connector} (live${since ? `, since ${since}` : ""}): ${r.upserted} records imported, ${r.pruned} pruned.`);
        break;
      }

      const DOCS = new Set(["notion", "linear", "jira", "drive"]);
      const connector =
        kind === "slack" && fixture
          ? new SlackConnector(fixture)
          : kind === "github" && fixture
            ? new GitHubConnector(fixture)
            : kind === "sessions" && fixture
              ? new SessionConnector(fixture, { owner: asUser ?? "me", scope: scopeArg ?? undefined })
              : kind === "email" && fixture
                ? new EmailConnector(fixture)
                : kind === "calendar" && fixture
                  ? new CalendarConnector(fixture)
                  : kind === "inbox" && fixture
                    ? new InboxConnector(fixture, { owner: asUser ?? undefined, scope: scopeArg ?? undefined })
                    : DOCS.has(kind) && fixture
                      ? new DocsConnector(kind, fixture)
                      : null;
      if (!connector) {
        console.log("usage: vitrus ingest <slack|github|sessions|email|calendar|inbox|notion|linear|jira|drive> <fixture.json|dir> | ingest rest --config <c.json>  [--as <owner> --scope <x>]");
        break;
      }
      const r = await ingest(engine, connector);
      await engine.refreshEntities();
      await engine.refreshSalience();
      console.log(`${r.connector}: ${r.upserted} records imported, ${r.pruned} pruned.`);
      break;
    }

    case "webhook": {
      // vitrus webhook <github|slack|connector> <event.json> — canlı değişikliği uygula
      const [conn, evPath] = rest;
      if (!conn || !evPath) {
        console.log("usage: vitrus webhook <github|slack|connector> <event.json>");
        break;
      }
      await engine.init();
      const payload = JSON.parse(readFileSync(evPath, "utf8"));

      if (conn === "slack") {
        // Slack: thread parçalanmasını önlemek için DOĞRUDAN delta değil, kanal SYNC'i tetikle.
        const { slackWebhookChannel } = await import("../connectors/webhooks.js");
        const { syncDedupKey } = await import("../connectors/sync.js");
        const channel = slackWebhookChannel(payload);
        if (!channel) { console.log("slack webhook: event.channel yok"); break; }
        const p: SyncPayload = { source: "slack", channel };
        const { id, deduped } = await engine.getQueue().enqueue("sync", p as unknown as Record<string, unknown>, { dedupKey: syncDedupKey(p) });
        console.log(deduped ? `slack webhook: sync already queued (#${id})` : `slack webhook: enqueued sync #${id} (channel ${channel}) · run: vitrus agent work`);
        break;
      }

      const queue = new ChangeQueue();
      if (conn === "github") {
        const { parseGitHubWebhook } = await import("../connectors/webhooks.js");
        for (const ev of parseGitHubWebhook(payload)) queue.enqueue(ev);
      } else {
        queue.enqueue(parseWebhook(conn, `working/${conn}/`, payload));
      }
      const r = await queue.drain(engine);
      await engine.refreshEntities();
      await engine.refreshSalience();
      console.log(`webhook ${conn}: applied ${r.upserts} upserts, ${r.deletes} deletes.`);
      break;
    }

    case "dashboard": {
      // vitrus dashboard [<odak-slug>] [--html dosya] — ekip görünürlük yüzeyi;
      // --graph → sıfır-bağımlılık SVG bilgi grafiği (C3).
      await engine.init();
      if (graphFlag) {
        const { renderGraphHtml } = await import("../api/graph.js");
        const snap = await engine.graphSnapshot(asofArg ? { asof: asofArg } : {});
        const asofTag = asofArg ? ` (as of ${asofArg})` : "";
        if (htmlOut) {
          writeFileSync(htmlOut, renderGraphHtml(snap));
          console.log(`graph written: ${htmlOut}${asofTag}`);
        } else {
          console.log(
            `graph${asofTag}: ${snap.nodes.length} nodes · ${snap.edges.length} edges${snap.truncated ? ` (+${snap.truncated} not shown)` : ""}`
          );
        }
        break;
      }
      const focusSlug = rest[0] || undefined;
      const data = await buildDashboard(
        engine,
        focusSlug ? { focusSlug, focusQuery: focusSlug.split("/").pop() ?? "" } : {}
      );
      if (htmlOut) {
        writeFileSync(htmlOut, renderDashboardHtml(data));
        console.log(`dashboard written: ${htmlOut}`);
      } else {
        console.log(
          `gaps:${data.gaps.length} · entities:${data.entities.length} · audit:${data.audit.length} · dedup:${data.dedup.length}${data.focus ? ` · chunks:${data.focus.chunks.length}` : ""}`
        );
      }
      break;
    }

    case "chunks": {
      // vitrus chunks <slug> [sorgu] — denetlenebilir chunk'lar (sorgu varsa skorlu)
      const slug = rest[0];
      if (!slug) {
        console.log("usage: vitrus chunks <slug> [query]");
        break;
      }
      await engine.init();
      const q = rest.slice(1).join(" ");
      if (q) {
        const cs = await engine.supportingChunks(slug, q);
        for (const c of cs) console.log(`  ${c.score.toFixed(3)}  #${c.idx}  ${c.content.slice(0, 80)}`);
        if (cs.length === 0) console.log("no chunks.");
      } else {
        const cs = await engine.getChunks(slug);
        for (const c of cs) console.log(`  #${c.idx}  ${c.content.slice(0, 80)}`);
        if (cs.length === 0) console.log("no chunks.");
      }
      break;
    }

    case "purge": {
      // SOC2/retention: soft-delete'li düğümleri KALICI sil. vitrus purge [gün]
      await engine.init();
      const days = rest[0] ? Number(rest[0]) : 0;
      const removed = await engine.purge({ retentionDays: Number.isFinite(days) ? days : 0 });
      console.log(`${removed} nodes permanently deleted (retention ${Number.isFinite(days) ? days : 0}d).`);
      break;
    }

    case "dream": {
      // Rüya döngüsü — gece cron olarak zamanlanır (deterministik konsolidasyon).
      const { dreamLoop, renderDream } = await import("../maintenance/dream-loop.js");
      await engine.init();
      console.log(renderDream(await dreamLoop(engine, { skills: loadSkillRefs(outDir) })));
      break;
    }

    case "brief":
    case "briefing": {
      // M3.8 — scheduled-prep "sabah brifingi": dikkat + boşluk + çelişki + düzeltilebilir-uncited (deterministik).
      const { buildBriefing, renderBriefing } = await import("../maintenance/dream-analysis.js");
      await engine.init();
      console.log(renderBriefing(await buildBriefing(engine, new Date().toISOString())));
      break;
    }

    case "dedup": {
      const pairs = await engine.dedupReview(0.92);
      if (pairs.length === 0) {
        console.log("no duplicate candidates (threshold 0.92).");
        break;
      }
      console.log("Dedup candidates (cosine ≥ 0.92):");
      for (const p of pairs) console.log(`  ${p.sim.toFixed(3)}  ${p.a} ↔ ${p.b}`);
      break;
    }

    case "audit": {
      // vitrus audit [<slug>] [--as <principal>] — "doc X'i kim gördü?"
      const entries = await engine.getAudit({ doc: arg || undefined, principal: asUser ?? undefined });
      if (entries.length === 0) {
        console.log("no audit records (authorized --as queries are written to the audit log).");
        break;
      }
      console.log(`Audit (${entries.length}):`);
      for (const e of entries)
        console.log(`  ${e.at} · [${e.principal}] "${e.query}" → ${e.returned.length} returned, ${e.excluded.length} excluded`);
      break;
    }

    case "entities": {
      const ents = await engine.listEntities(1);
      if (ents.length === 0) {
        console.log("no entities (first run: vitrus import/ingest).");
        break;
      }
      console.log("Entities (by frequency):");
      for (const e of ents) console.log(`  ${e.mentionCount}×  ${e.name} (${e.entityType})`);
      break;
    }

    case "mcp": {
      // MCP server — ajanlara aç. Sürekli çalışır; engine.close() çağrılmaz.
      const { runStdio, runHttp } = await import("../mcp/server.js");
      const { verifierFromEnv } = await import("../mcp/auth.js");
      await engine.init();
      // VITRUS_BRAIN → ajan-yazma (remember/record_decision) markdown KAYNAĞINA persist
      // edilir (sahiplik invariantı; reindex'te kalır). Tanımsızsa index-only.
      const brainDir = ENV.VITRUS_BRAIN;
      const store = brainDir ? new MarkdownStore(brainDir) : undefined;
      if (httpPort !== null) {
        const resource = ENV.VITRUS_RESOURCE ?? `http://localhost:${httpPort}/mcp`;
        const verifier = verifierFromEnv(resource, ENV.VITRUS_AUTH_TOKENS) ?? undefined;
        await runHttp(engine, httpPort, { verifier, resource, store });
        console.error(
          `Vitrus MCP (Streamable HTTP) → http://localhost:${httpPort}/mcp · ${verifier ? "OAuth-protected" : "open (dev)"}` +
            (store ? ` · writes → ${brainDir}` : " · writes index-only (set VITRUS_BRAIN)")
        );
      } else {
        console.error("Vitrus MCP (stdio) ready." + (store ? ` writes → ${brainDir}` : " writes index-only (set VITRUS_BRAIN)"));
        await runStdio(engine, store);
      }
      return;
    }

    case "onboard": {
      // M2 — Day-One: rol/alan için beyinden sıralı, kaynaklı öğrenme yolu (+ kime-sor + boşluklar).
      await engine.init();
      const role = rest.filter((a) => !a.startsWith("--")).join(" ");
      if (!role) { console.log('usage: vitrus onboard "<role or area>" [--as <user>]'); break; }
      const { buildCurriculum, renderCurriculum } = await import("../onboard/curriculum.js");
      const principals = asUser ? await engine.expandPrincipals(asUser) : undefined;
      console.log(renderCurriculum(await buildCurriculum(engine, role, { principals })));
      break;
    }

    case "quiz": {
      // M2 — bilgi sınavı: konudan soru üret (cevap `vitrus verify` ile deterministik notlanır).
      await engine.init();
      const topic = rest.filter((a) => !a.startsWith("--")).join(" ");
      if (!topic) { console.log('usage: vitrus quiz "<topic>" [--as <user>]  (grade an answer with: vitrus verify "<answer>")'); break; }
      const { generateQuiz } = await import("../onboard/quiz.js");
      const principals = asUser ? await engine.expandPrincipals(asUser) : undefined;
      const qs = await generateQuiz(engine, topic, { principals });
      qs.forEach((q, i) => console.log(`${i + 1}. ${q.question}`));
      console.log(qs.length ? '\nAnswer, then grade with: vitrus verify "<your answer>"' : "(no questions — first: vitrus import <dir>)");
      break;
    }

    case "api": {
      // M1 Faz B — Agent-Native API Hub (Gorilla): import/search/describe/verify/call.
      await engine.init();
      const sub = rest[0];
      const takeOne = (flag: string): string | undefined => { const i = rest.indexOf(flag); return i >= 0 && rest[i + 1] ? rest[i + 1] : undefined; };
      const { normalizeOpenApi, cardToNode, cardToContent } = await import("../api-hub/normalize.js");
      const { apiSearch, findEndpoint } = await import("../api-hub/retrieve.js");
      const { verifyApiCall, renderVerdict } = await import("../api-hub/verify-call.js");
      if (sub === "import") {
        const spec = JSON.parse(readFileSync(rest[1], "utf8"));
        const cards = normalizeOpenApi(spec, takeOne("--name"));
        for (const c of cards) await engine.putNode(cardToNode(c));
        await engine.refreshEntities();
        console.log(`✓ imported ${cards.length} endpoints from "${cards[0]?.apiName ?? "api"}" → durable/apis/`);
        break;
      }
      if (sub === "search") {
        const task = rest.slice(1).filter((a) => !a.startsWith("--")).join(" ");
        const hits = await apiSearch(engine, task, { limit: 6 });
        for (const h of hits) console.log(`  ${h.score.toFixed(4)}  ${h.card.method} ${h.card.path}  (${h.card.operationId}) — ${h.card.summary}`);
        if (!hits.length) console.log("(no API endpoints — first: vitrus api import <spec.json>)");
        break;
      }
      if (sub === "describe") {
        const card = await findEndpoint(engine, rest[1] ?? "");
        if (!card) { console.log(`endpoint not found: ${rest[1] ?? ""} (try: vitrus api search "...")`); break; }
        console.log(cardToContent(card));
        break;
      }
      if (sub === "verify" || sub === "call") {
        const ref = rest[1] ?? "";
        const args = ((): Record<string, unknown> => { const a = takeOne("--args"); try { return a ? JSON.parse(a) : {}; } catch { return {}; } })();
        const card = await findEndpoint(engine, ref);
        if (sub === "verify") { console.log(renderVerdict(verifyApiCall(card, args), ref)); break; }
        if (!card) { console.log(renderVerdict(verifyApiCall(undefined, args), ref)); console.log("✗ blocked — endpoint not found (possible hallucination)"); break; }
        const { callApi } = await import("../api-hub/execute.js");
        const r = await callApi(card, args, { token: takeOne("--token"), baseUrl: takeOne("--base"), dryRun: rest.includes("--dry-run"), allowDeprecated: rest.includes("--allow-deprecated") });
        console.log(renderVerdict(r.verdict, ref));
        if (!r.ok) { console.log("✗ blocked — fix the call before executing"); break; }
        if (rest.includes("--dry-run")) { console.log(`(dry-run) ${card.method} ${r.url}`); break; }
        console.log(`→ HTTP ${r.status}  ${card.method} ${r.url}`);
        console.log(typeof r.body === "string" ? r.body.slice(0, 800) : JSON.stringify(r.body, null, 2).slice(0, 800));
        break;
      }
      console.log("usage: vitrus api <import <spec.json> [--name n] | search \"<task>\" | describe <ref> | verify <ref> --args '{}' | call <ref> --args '{}' [--token t] [--base u] [--dry-run]>");
      break;
    }

    case "capture": {
      // Tek-komut yakalama (gbrain capture paritesi): arg / --file <path> / stdin → working/inbox/<date>-<hash> notu.
      // usage: vitrus capture "<text>" | vitrus capture --file <path> | echo ... | vitrus capture  [--title <t>] [--as <owner>] [--scope <x>]
      await engine.init();
      let textInput = "";
      const fileIdx = rest.indexOf("--file");
      if (fileIdx >= 0 && rest[fileIdx + 1]) {
        textInput = readFileSync(rest[fileIdx + 1], "utf8");
        rest.splice(fileIdx, 2);
      }
      const titleIdx = rest.indexOf("--title");
      const titleArg = titleIdx >= 0 && rest[titleIdx + 1] ? rest[titleIdx + 1] : undefined;
      if (titleIdx >= 0) rest.splice(titleIdx, titleArg ? 2 : 1);
      if (!textInput) {
        const positional = rest.filter((a) => !a.startsWith("--")).join(" ").trim();
        textInput = positional || (await readStdin());
      }
      if (!textInput.trim()) {
        console.log('usage: vitrus capture "<text>" | --file <path> | (stdin)  [--title <t>] [--as <owner>] [--scope <x>]');
        break;
      }
      const now = new Date().toISOString();
      const rec = captureRecord(textInput, { now, title: titleArg, owner: asUser ?? undefined, scope: scopeArg ?? undefined });
      const node = recordToNode("capture", rec);
      const brainDir = ENV.VITRUS_BRAIN;
      if (brainDir) new MarkdownStore(brainDir).writeNode(node); // markdown KAYNAĞA persist (reindex'te kalır)
      await engine.putNode(node);
      await engine.refreshEntities();
      console.log(`✓ captured: ${rec.slug}${brainDir ? ` · writes → ${brainDir}` : " · index-only (set VITRUS_BRAIN to persist)"}`);
      break;
    }

    case "decide": {
      // Karardan-sonra-yaz döngüsünün terminal/CI yüzeyi (record_decision MCP aracıyla aynı motor).
      // usage: vitrus decide "<decision>" [--why <rationale>] [--supersedes <slug>] [--contradicts <slug>] [--source <slug|url>]... [--title <t>] [--as <user>]
      await engine.init();
      const raw = process.argv.slice(2); // ["decide", ...]
      const takeOne = (flag: string): string | undefined => {
        const i = raw.indexOf(flag);
        if (i >= 0 && raw[i + 1]) { const v = raw[i + 1]; raw.splice(i, 2); return v; }
        return undefined;
      };
      const takeMany = (flag: string): string[] => {
        const out: string[] = [];
        let i: number;
        while ((i = raw.indexOf(flag)) >= 0 && raw[i + 1]) { out.push(raw[i + 1]); raw.splice(i, 2); }
        return out;
      };
      const rationale = takeOne("--why");
      const supersedes = takeOne("--supersedes");
      const contradicts = takeOne("--contradicts");
      const title = takeOne("--title");
      const sources = takeMany("--source");
      const asFlag = takeOne("--as");
      const decision = raw.slice(1).filter((a) => !a.startsWith("--")).join(" ");
      if (!decision) { console.log('usage: vitrus decide "<decision>" [--why <rationale>] [--supersedes <slug>] [--contradicts <slug>] [--source <slug|url>]... [--title <t>] [--as <user>]'); break; }
      const { callTool } = await import("../mcp/tools.js");
      const brainDir = ENV.VITRUS_BRAIN;
      const store = brainDir ? new MarkdownStore(brainDir) : undefined;
      const principals = (asFlag ?? asUser) ? await engine.expandPrincipals((asFlag ?? asUser)!) : undefined;
      const r = await callTool(
        engine,
        "record_decision",
        { decision, rationale, supersedes, contradicts, title, sources },
        { store, principals }
      );
      const out = r.structuredContent as { slug: string; persisted: string; conflicts: { message: string }[]; superseded: string[] };
      console.log(`✓ decision recorded: ${out.slug} (${out.persisted})`);
      if (out.superseded.length) console.log(`  supersedes (now stale): ${out.superseded.join(", ")}`);
      if (out.conflicts.length) console.log(`  ⚠ ${out.conflicts.length} contradiction(s):\n    - ${out.conflicts.map((c) => c.message).join("\n    - ")}`);
      break;
    }

    case "hooks": {
      // Ajan entegrasyonu kur: MCP bağlantısı + read-before/write-after disiplini + hook'lar.
      // Mevcut dosyaların ÜZERİNE YAZMAZ → <path>.vitrus-suggested yazıp elle birleştirmeyi söyler.
      const sub = rest[0];
      if (sub && sub !== "install") {
        console.log("usage: vitrus hooks install [--agent claude|cursor|codex] [--dir <path>]");
        break;
      }
      const agentIdx = rest.indexOf("--agent");
      const agent = (agentIdx >= 0 && rest[agentIdx + 1] ? rest[agentIdx + 1] : "claude") as AgentKind;
      if (!["claude", "cursor", "codex"].includes(agent)) {
        console.log(`unknown agent: ${agent} (use: claude | cursor | codex)`);
        break;
      }
      const dirIdx = rest.indexOf("--dir");
      const targetDir = dirIdx >= 0 && rest[dirIdx + 1] ? rest[dirIdx + 1] : ".";
      const files = hooksFor(agent, { brainDir: ENV.VITRUS_BRAIN ?? "./brain", dataDir: DATA_DIR });
      console.log(`Vitrus hooks · agent=${agent} · dir=${targetDir}`);
      for (const f of files) {
        const dest = join(targetDir, f.path);
        const finalDest = existsSync(dest) ? dest + ".vitrus-suggested" : dest;
        mkdirSync(dirname(finalDest), { recursive: true });
        writeFileSync(finalDest, f.content, "utf8");
        console.log(
          finalDest === dest
            ? `  + ${f.path}`
            : `  ~ ${f.path} exists → wrote ${f.path}.vitrus-suggested (merge manually)`
        );
      }
      console.log("\nNext: ensure `vitrus` is on PATH (bun link), then start your agent — it connects to the 'vitrus' MCP server.");
      break;
    }

    case "agent": {
      // Dayanıklı sub-agent yürütme (gbrain paritesi): enqueue + worker (crash recovery).
      await engine.init();
      const queue = engine.getQueue();
      const sub = rest[0];
      if (sub === "run") {
        const q = rest.slice(1).join(" ");
        if (!q) { console.log('usage: vitrus agent run "<query>"'); break; }
        const { id, deduped } = await queue.enqueue("think", { query: q }, { dedupKey: `think:${q}` });
        console.log(deduped ? `already queued as job #${id}` : `enqueued job #${id} (kind=think) · run worker: vitrus agent work`);
      } else if (sub === "work") {
        const maxIdx = rest.indexOf("--max");
        const max = maxIdx >= 0 ? Number(rest[maxIdx + 1]) : undefined;
        const r = await workOff(queue, (job) => runJob(engine, job), { max });
        console.log(`worked ${r.processed} jobs · ${r.done} done · ${r.failed} failed`);
      } else {
        console.log('usage: vitrus agent <run "<query>" | work [--max N]>');
      }
      break;
    }

    case "jobs": {
      // Kuyruk durumu + son işler (dayanıklı yürütmenin denetlenebilir izi).
      await engine.init();
      const queue = engine.getQueue();
      const s = await queue.stats();
      console.log(`jobs: queued ${s.queued} · running ${s.running} · done ${s.done} · failed ${s.failed}`);
      for (const j of await queue.list({ limit: 10 })) {
        const tail = j.status === "done" && j.result ? ` → ${JSON.stringify(j.result).slice(0, 60)}` : j.lastError ? ` ✗ ${j.lastError}` : "";
        console.log(`  #${j.id} [${j.status}] ${j.kind} (att ${j.attempts}/${j.maxAttempts})${tail}`);
      }
      break;
    }

    case "doctor": {
      // Sağlık + "ne çalıştırıyorum" (backend + sağlayıcılar, SIR SIZDIRMADAN).
      await engine.init();
      console.log(renderConfig(resolveConfig(pgUrl ? { ...process.env, VITRUS_PG_URL: pgUrl } : process.env)));
      const d = await engine.doctor();
      console.log(d.ok ? "✓ healthy" : `⚠ issues:\n  - ${d.issues.join("\n  - ")}`);
      break;
    }

    case "config":
      // Çözülen yapılandırma (backend + embedder/synth/reranker sağlayıcıları).
      console.log(renderConfig(resolveConfig(pgUrl ? { ...process.env, VITRUS_PG_URL: pgUrl } : process.env)));
      break;

    case "bench": {
      // Benchmark dispatcher. gapeval süreç-içi koşar (her vaka için taze izole motor).
      // NOT: genel bayrak ayıklayıcı (--out vb.) rest'i değiştirdiği için HAM argv kullanılır.
      const raw = process.argv.slice(2); // ["bench", <suite>, ...bayraklar]
      const suite = raw[1];
      if (suite === "gapeval") {
        const { main: gapevalMain } = await import("../eval/gapeval/run.js");
        const code = await gapevalMain(raw.slice(2));
        await engine.close();
        process.exit(code);
      }
      console.log(
        [
          "usage: vitrus bench gapeval [--out <path>] [--negative-control] [--determinism] [--case <substr>]",
          "  gapeval: gap-detection quality vs the gold-labeled corpus (src/eval/gapeval/corpus)",
          "  the retrieval benchmark (recall/accuracy/latency) runs via: bun run bench",
        ].join("\n")
      );
      break;
    }

    case "version":
    case "--version":
    case "-v": {
      const here = dirname(fileURLToPath(import.meta.url));
      const pkg = JSON.parse(readFileSync(join(here, "../../package.json"), "utf8"));
      console.log(`vitrus ${pkg.version} (core)`);
      break;
    }

    default:
      console.log(
        "usage: vitrus <init | import <dir> | capture \"<text>\" [--file f|--title t|--as u] | api <import|search|describe|verify|call> | ingest <slack|github|sessions|email|calendar|inbox|notion|linear|jira|drive> <fixture> | ingest rest --config <c.json> | ingest <github --live --repo <o/n> | slack --live --channel <Cxxxx> | notion|linear|drive|gmail --live | jira --live --site <co> --email <e>> [--token <t>] [--since <iso>] [--queue] | webhook <github|slack|connector> <event> | sync <dir> | search <q> [--as <user>] [--scope <x>] [--explain] [--postgres <url>] | think <q> [--html f|--json] [--scope <x>] | verify <claim> [--as <user>] | decide \"<decision>\" [--why <r>] [--supersedes <slug>] [--contradicts <slug>] [--source <s>]... [--as <user>] | gaps | ops | conflicts | resolve <keep> <supersede> | entities | dedup | dream | purge [days] | audit [<slug>] | dashboard [--html f] [--graph [--asof <ISO>]] | chunks <slug> [q] | agent run <q> | agent work [--max N] | jobs | bench gapeval [--out <f> --negative-control --determinism] | doctor | config | version | skill <topic> [--publish --out <dir> | --eval] | skills [list|show <name>|install [--out d]] | skill-eval <name> [--out <dir>] | skill-curate [--out <dir>] | skill-optimize <name> [--apply --out <dir>] | hooks install [--agent claude|cursor|codex] [--dir <path>] | mcp [--http <port>]>"
      );
  }

  await engine.close();
}

/** İş işleyici (worker): kuyruktan gelen işi deterministik motor çağrısına eşler. */
async function runJob(engine: PgliteEngine, job: Job): Promise<unknown> {
  switch (job.kind) {
    case "think": {
      const r = await engine.think(String(job.payload.query ?? ""));
      return { answer: r.answer.slice(0, 200), citations: r.citations.length, gaps: r.gaps.length };
    }
    case "enrich":
      await engine.refreshEntities();
      await engine.refreshSalience();
      return { ok: true };
    case "sync": {
      // Connector incremental senkronu (token env'den; payload'da sır taşınmaz).
      const { runSyncJob } = await import("../connectors/sync.js");
      const r = await runSyncJob(engine, job.payload as unknown as SyncPayload, { env: ENV });
      return { connector: r.connector, upserted: r.upserted, pruned: r.pruned };
    }
    default:
      throw new Error(`unknown job kind: ${job.kind}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
