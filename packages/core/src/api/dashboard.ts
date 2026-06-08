// src/api/dashboard.ts
// Ekip dashboard'u — VERİ + sunum. Tam Next.js kabuğu (React) yerine sıfır-bağımlılık
// SSR HTML (sürüm boyunca tutulan ethos). Üretim Next.js ön-yüzü AYNI veriyi tüketir;
// SSO/RBAC T21 OAuth desenini yeniden kullanır.
//
// Gösterir: boşluk raporu · varlıklar · retrieval audit'i · dedup adayları ·
// (opsiyonel) bir düğümün DENETLENEBİLİR chunk'ları (hangi chunk cevabı destekledi — F6).

import type { BrainEngine } from "../core/engine.js";
import type { Gap, Entity, AuditEntry } from "../core/types.js";

export interface DashboardData {
  gaps: Gap[];
  entities: Entity[];
  audit: AuditEntry[];
  dedup: { a: string; b: string; sim: number }[];
  focus: { slug: string; query: string; chunks: { idx: number; content: string; score: number }[] } | null;
}

export async function buildDashboard(
  engine: BrainEngine,
  opts: { focusSlug?: string; focusQuery?: string; limit?: number } = {}
): Promise<DashboardData> {
  const limit = opts.limit ?? 10;
  // Sıralı (PGLite tek bağlantı — eşzamanlı sorgu desteklenmez).
  const gaps = await engine.findGaps();
  const entities = await engine.listEntities(1);
  const audit = await engine.getAudit();
  const dedup = await engine.dedupReview(0.92);
  const focus = opts.focusSlug
    ? {
        slug: opts.focusSlug,
        query: opts.focusQuery ?? "",
        chunks: await engine.supportingChunks(opts.focusSlug, opts.focusQuery ?? ""),
      }
    : null;
  return { gaps, entities: entities.slice(0, limit), audit: audit.slice(0, limit), dedup, focus };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderDashboardHtml(d: DashboardData): string {
  const gapRows = d.gaps.map((g) => `<tr><td class="k">${esc(g.kind)}</td><td>${esc(g.message)}</td></tr>`).join("");
  const entRows = d.entities
    .map((e) => `<tr><td>${e.mentionCount}×</td><td>${esc(e.name)}</td><td class="mut">${esc(e.entityType)}</td></tr>`)
    .join("");
  const auditRows = d.audit.length
    ? d.audit
        .map((a) => `<tr><td class="mut">${esc(a.at)}</td><td>${esc(a.principal)}</td><td>${esc(a.query)}</td><td>${a.returned.length}↩ ${a.excluded.length}⊘</td></tr>`)
        .join("")
    : `<tr><td colspan="4" class="mut">(no audit records — authorized queries are written)</td></tr>`;
  const dedupRows = d.dedup.length
    ? d.dedup.map((p) => `<tr><td>${p.sim.toFixed(3)}</td><td>${esc(p.a)} ↔ ${esc(p.b)}</td></tr>`).join("")
    : `<tr><td colspan="2" class="mut">(no duplicate candidates)</td></tr>`;
  const focusBlock = d.focus
    ? `<section><h2>Auditable chunks — <code>${esc(d.focus.slug)}</code></h2>
       <p class="mut">chunks that most support the query "${esc(d.focus.query)}" (score = cosine):</p>
       ${d.focus.chunks
         .map((c) => `<div class="chunk"><span class="score">${c.score.toFixed(3)}</span> <span class="cidx">#${c.idx}</span> ${esc(c.content.slice(0, 200))}</div>`)
         .join("")}</section>`
    : "";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Vitrus — Team Dashboard</title>
<style>
  :root{--green:#1a7f5a;--amber:#b97e16;--amberbg:#fdf4e3;--ink:#1c2024;--mut:#6b7280;--line:#e5e7eb;}
  *{box-sizing:border-box}body{font:14px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:var(--ink);background:#f3f4f6;margin:0;padding:24px}
  .wrap{max-width:860px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}.sub{color:var(--mut);margin:0 0 20px}
  section{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 18px;margin-bottom:16px}
  h2{font-size:15px;margin:0 0 10px}table{width:100%;border-collapse:collapse}td{padding:5px 8px;border-bottom:1px solid var(--line);vertical-align:top}
  .k{font-weight:600;text-transform:uppercase;font-size:10px;color:var(--amber);background:var(--amberbg);border-radius:4px;white-space:nowrap}
  .mut{color:var(--mut)}code{background:#f3f4f6;padding:1px 5px;border-radius:4px}
  .chunk{border-left:3px solid var(--green);padding:6px 10px;margin:6px 0;background:#f9fafb;border-radius:0 6px 6px 0}
  .score{color:var(--green);font-weight:700}.cidx{color:var(--mut);font-size:11px}
</style></head><body><div class="wrap">
  <h1>Vitrus — Team Dashboard</h1>
  <p class="sub">visibility · gaps · audit · consolidation (SSR; production Next.js consumes the same API)</p>
  <section><h2>⚠ What the brain doesn't know (${d.gaps.length})</h2><table>${gapRows}</table></section>
  <section><h2>Entities (by frequency)</h2><table>${entRows}</table></section>
  <section><h2>Retrieval audit — "who saw doc X?"</h2><table>${auditRows}</table></section>
  <section><h2>Dedup candidates (≥0.92)</h2><table>${dedupRows}</table></section>
  ${focusBlock}
</div></body></html>
`;
}
