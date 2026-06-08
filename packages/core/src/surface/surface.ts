// src/surface/surface.ts
// Katman 4 — Görünürlük yüzeyi. ThinkResult'ı "biliniyor / boşluk / kaynak /
// güven" görünümüne çevirir. Kendi zekası yoktur; motorun ürettiğini görünür kılar.
// İki renderer: CLI metni + tek-sayfa, bağımlılıksız HTML (mockup).

import type { ThinkResult, Gap, Mode } from "../core/types.js";

export interface SourceTag {
  marker: number; // [n]
  slug: string;
  label: string; // yeşil etiket metni (tier öneki atılmış)
  uri: string | null;
}

export interface VisibilitySurface {
  query: string;
  mode: Mode;
  answer: string; // [n] işaretleriyle
  sources: SourceTag[];
  gaps: Gap[];
  cards: { sources: number; openGaps: number; oldestSourceDays: number; confidence: number };
}

/** Güven skoru — DETERMİNİSTİK ve AÇIK (glass-box). Bileşenleri kartlarda gösterilir. */
export function scoreConfidence(p: {
  cites: number;
  gaps: number;
  oldestDays: number;
  topCosine: number | null;
}): number {
  const grounding = Math.min(1, p.cites / 3); // ≥3 kaynak → tam temellendirme
  const coverage = p.topCosine === null ? 0 : Math.min(1, p.topCosine / 0.5);
  const gapPenalty = Math.min(0.6, 0.15 * p.gaps); // her boşluk güveni kırar
  const freshness = p.oldestDays > 90 ? 0.85 : 1;
  const raw = (0.6 * grounding + 0.4 * coverage) * (1 - gapPenalty) * freshness;
  return Math.round(Math.max(0, Math.min(1, raw)) * 100) / 100;
}

function labelOf(slug: string): string {
  return slug.replace(/^(durable|working|derived)\//, "");
}

export function buildSurface(query: string, r: ThinkResult): VisibilitySurface {
  return {
    query,
    mode: r.mode,
    answer: r.answer,
    sources: r.citations.map((c, i) => ({
      marker: i + 1,
      slug: c.slug,
      label: labelOf(c.slug),
      uri: c.uri,
    })),
    gaps: r.gaps,
    cards: {
      sources: r.citations.length,
      openGaps: r.gaps.length,
      oldestSourceDays: r.oldestSourceDays,
      confidence: r.confidence,
    },
  };
}

const GAP_LABEL: Record<Gap["kind"], string> = {
  missing: "missing",
  contradiction: "contradiction",
  stale: "stale",
  uncited: "uncited",
  single_point: "single-point",
};

// --- CLI renderer ---------------------------------------------------------
export function renderSurfaceText(s: VisibilitySurface): string {
  const out: string[] = [];
  out.push(`[${s.mode} mode]  "${s.query}"`, "");
  out.push("SYNTHESIZED ANSWER", s.answer, "");
  if (s.sources.length) {
    out.push("Sources:");
    for (const src of s.sources) out.push(`  [${src.marker}] ${src.label}${src.uri ? "  ↗ " + src.uri : ""}`);
    out.push("");
  }
  if (s.gaps.length) {
    out.push("⚠ What the brain doesn't know (gap analysis):");
    for (const g of s.gaps) out.push(`  [${GAP_LABEL[g.kind]}] ${g.message}`);
    out.push("");
  }
  const c = s.cards;
  out.push(
    `┌ sources: ${c.sources}  ·  open gaps: ${c.openGaps}  ·  oldest source: ${c.oldestSourceDays}d  ·  confidence: ${Math.round(
      c.confidence * 100
    )}% ┐`
  );
  return out.join("\n");
}

// --- HTML renderer (tek-sayfa, bağımlılıksız) -----------------------------
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Cevaptaki [n] işaretlerini yeşil kaynak çiplerine çevirir. */
function answerHtml(s: VisibilitySurface): string {
  const byMarker = new Map(s.sources.map((src) => [src.marker, src]));
  return esc(s.answer)
    .replace(/\n/g, "<br>")
    .replace(/\[(\d+)\]/g, (_m, n: string) => {
      const src = byMarker.get(Number(n));
      if (!src) return `[${n}]`;
      const inner = `<span class="src">${esc(src.label)}</span>`;
      return src.uri ? `<a class="srclink" href="${esc(src.uri)}" target="_blank">${inner}</a>` : inner;
    });
}

export function renderSurfaceHtml(s: VisibilitySurface): string {
  const c = s.cards;
  const gapsHtml = s.gaps
    .map((g) => `<li><span class="gk">${GAP_LABEL[g.kind]}</span> ${esc(g.message)}</li>`)
    .join("");
  const gapBox = s.gaps.length
    ? `<div class="gapbox"><div class="gaphd">⚠ What the brain doesn't know (gap analysis)</div><ul>${gapsHtml}</ul></div>`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vitrus — ${esc(s.query)}</title>
<style>
  :root { --green:#1a7f5a; --greenbg:#e6f4ee; --amber:#b97e16; --amberbg:#fdf4e3; --ink:#1c2024; --mut:#6b7280; --line:#e5e7eb; }
  * { box-sizing:border-box; }
  body { font:15px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; color:var(--ink); background:#f3f4f6; margin:0; padding:32px 16px; }
  .card { max-width:760px; margin:0 auto; background:#fff; border:1px solid var(--line); border-radius:12px; box-shadow:0 1px 3px rgba(0,0,0,.05); overflow:hidden; }
  .hd { display:flex; justify-content:space-between; align-items:center; padding:14px 20px; border-bottom:1px solid var(--line); }
  .brand { font-weight:700; }
  .mode { font-size:12px; background:#eef2ff; color:#4338ca; padding:2px 8px; border-radius:999px; margin-left:8px; }
  .tiers { font-size:12px; color:var(--mut); }
  .q { padding:14px 20px; font-style:italic; color:#374151; border-bottom:1px solid var(--line); }
  .lbl { font-size:11px; letter-spacing:.08em; color:var(--mut); padding:16px 20px 0; }
  .ans { padding:8px 20px 16px; }
  .src { background:var(--greenbg); color:var(--green); font-size:12px; padding:1px 6px; border-radius:5px; white-space:nowrap; }
  .srclink { text-decoration:none; }
  .gapbox { margin:0 20px 16px; background:var(--amberbg); border:1px solid #f0dcae; border-radius:8px; padding:12px 14px; }
  .gaphd { color:var(--amber); font-weight:600; font-size:13px; margin-bottom:6px; }
  .gapbox ul { margin:0; padding-left:18px; }
  .gapbox li { margin:3px 0; font-size:13px; color:#5b4a2a; }
  .gk { font-weight:600; text-transform:uppercase; font-size:10px; background:#fff; border:1px solid #e6cf9f; color:var(--amber); padding:1px 5px; border-radius:4px; margin-right:4px; }
  .cards { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; padding:0 20px 18px; }
  .cell { border:1px solid var(--line); border-radius:8px; padding:10px 12px; }
  .cell .k { font-size:11px; color:var(--mut); }
  .cell .v { font-size:20px; font-weight:700; margin-top:2px; }
  .foot { padding:10px 20px; border-top:1px solid var(--line); font-size:11px; color:var(--mut); }
</style></head>
<body><div class="card">
  <div class="hd"><div><span class="brand">Vitrus</span><span class="mode">${esc(s.mode)} mode</span></div><div class="tiers">working · derived · durable</div></div>
  <div class="q">" ${esc(s.query)}</div>
  <div class="lbl">SYNTHESIZED ANSWER</div>
  <div class="ans">${answerHtml(s)}</div>
  ${gapBox}
  <div class="cards">
    <div class="cell"><div class="k">sources</div><div class="v">${c.sources}</div></div>
    <div class="cell"><div class="k">open gaps</div><div class="v">${c.openGaps}</div></div>
    <div class="cell"><div class="k">oldest source</div><div class="v">${c.oldestSourceDays}d</div></div>
    <div class="cell"><div class="k">confidence</div><div class="v">${Math.round(c.confidence * 100)}%</div></div>
  </div>
  <div class="foot">Green tag = a claim with a source · yellow box = what the brain doesn't know · cards = trust indicators. No claim is shown without a source.</div>
</div></body></html>
`;
}
