#!/usr/bin/env bun
// src/cli/index.ts
// Vitrus CLI. Faz 0 hedefi: init / import / sync / search / think çalışsın.
// `sync` depo → sidecar (kaynak-üstü graf) yazar; motor retrieval'ı sonraki tasklar.

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
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
import { buildSkillPack, skillPackToBundle } from "../skill/skill-export.js";
import { validateSkillFile, skillFileToMarkdown } from "../skill/skill-file.js";
import { runSkillEval, renderSkillEvalReport, parseSkillEval } from "../skill/skill-eval.js";
import { skillifyCandidates, findStaleSkills, loadSkillRefs, renderCuration } from "../maintenance/skill-curator.js";
import { optimizeSkill, renderOptimize } from "../skill/skill-optimize.js";
import { ingest } from "../connectors/ingest.js";
import { SlackConnector } from "../connectors/slack.js";
import { GitHubConnector } from "../connectors/github.js";
import { DocsConnector } from "../connectors/docs.js";
import { SessionConnector } from "../connectors/sessions.js";
import { EmailConnector } from "../connectors/email.js";
import { CalendarConnector } from "../connectors/calendar.js";
import { ChangeQueue, parseWebhook } from "../connectors/webhook.js";
import { resolveConfig, renderConfig } from "../core/config.js";
import { buildDashboard, renderDashboardHtml } from "../api/dashboard.js";
import { normalizeEnv } from "../core/env.js";

// Eski GLASSBOX_*/LUCIDEX_* env adlarını da kabul et (marka geçişi geriye-uyumu).
const ENV = normalizeEnv(process.env);

// Embedder: multilingual OpenAIEmbedder when OPENAI_API_KEY is set (cross-lingual
// retrieval), else the offline-deterministic HashingEmbedder. The brain is
// content-language-agnostic; this is where cross-lingual capability plugs in.
const embedder = embedderFromEnv();
// Kalıcı dev veri dizini — CLI çağrıları arasında türev indeks korunur.
const DATA_DIR = ENV.VITRUS_DATA ?? "./.vitrus";

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
      // vitrus ingest <slack|github> <fixture.json>
      const [kind, fixture] = rest;
      await engine.init();
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
                  : DOCS.has(kind) && fixture
                    ? new DocsConnector(kind, fixture)
                    : null;
      if (!connector) {
        console.log("usage: vitrus ingest <slack|github|sessions|email|calendar|notion|linear|jira|drive> <fixture.json|dir> [--as <owner> --scope <x>]");
        break;
      }
      const r = await ingest(engine, connector);
      await engine.refreshEntities();
      await engine.refreshSalience();
      console.log(`${r.connector}: ${r.upserted} records imported, ${r.pruned} pruned.`);
      break;
    }

    case "webhook": {
      // vitrus webhook <connector> <event.json> — canlı değişikliği uygula
      const [conn, evPath] = rest;
      if (!conn || !evPath) {
        console.log("usage: vitrus webhook <connector> <event.json>");
        break;
      }
      await engine.init();
      const payload = JSON.parse(readFileSync(evPath, "utf8"));
      const queue = new ChangeQueue();
      queue.enqueue(parseWebhook(conn, `working/${conn}/`, payload));
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
        const snap = await engine.graphSnapshot();
        if (htmlOut) {
          writeFileSync(htmlOut, renderGraphHtml(snap));
          console.log(`graph written: ${htmlOut}`);
        } else {
          console.log(
            `graph: ${snap.nodes.length} nodes · ${snap.edges.length} edges${snap.truncated ? ` (+${snap.truncated} not shown)` : ""}`
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
      if (httpPort !== null) {
        const resource = ENV.VITRUS_RESOURCE ?? `http://localhost:${httpPort}/mcp`;
        const verifier = verifierFromEnv(resource, ENV.VITRUS_AUTH_TOKENS) ?? undefined;
        await runHttp(engine, httpPort, { verifier, resource });
        console.error(
          `Vitrus MCP (Streamable HTTP) → http://localhost:${httpPort}/mcp · ${verifier ? "OAuth-protected" : "open (dev)"}`
        );
      } else {
        console.error("Vitrus MCP (stdio) ready.");
        await runStdio(engine);
      }
      return;
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
        "usage: vitrus <init | import <dir> | ingest <slack|github|sessions|email|calendar|notion|linear|jira|drive> <fixture> | webhook <connector> <event> | sync <dir> | search <q> [--as <user>] [--scope <x>] [--postgres <url>] | think <q> [--html f|--json] [--scope <x>] | verify <claim> [--as <user>] | gaps | entities | dedup | dream | purge [days] | audit [<slug>] | dashboard [--html f] [--graph] | chunks <slug> [q] | agent run <q> | agent work [--max N] | jobs | doctor | config | version | skill <topic> [--publish --out <dir> | --eval] | skill-eval <name> [--out <dir>] | skill-curate [--out <dir>] | skill-optimize <name> [--apply --out <dir>] | mcp [--http <port>]>"
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
    default:
      throw new Error(`unknown job kind: ${job.kind}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
