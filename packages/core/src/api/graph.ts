// src/api/graph.ts
// C3 — sıfır-bağımlılık SSR SVG graf görünümü. "AI'ın bildiğini GÖR" (Obsidian/nessielabs
// tezi): düğüm = nokta (tier rengi), tipli kenar = çizgi, bayat = kırmızı kesik, gap = amber
// halka. Dairesel deterministik yerleşim (force-directed kütüphane YOK, bağımlılık YOK).

import type { GraphSnapshot } from "../core/types.js";

const TIER_COLOR: Record<string, string> = { durable: "#1a7f5a", derived: "#4338ca", working: "#b97e16" };

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function label(slug: string): string {
  return slug.replace(/^(durable|working|derived)\//, "").replace(/^[a-z]+\//, "");
}

export function renderGraphSvg(g: GraphSnapshot, opts: { width?: number; height?: number } = {}): string {
  const W = opts.width ?? 820;
  const H = opts.height ?? 620;
  const cx = W / 2;
  const cy = H / 2;
  const R = Math.min(W, H) / 2 - 80;
  const n = g.nodes.length;

  const pos = new Map<string, { x: number; y: number }>();
  g.nodes.forEach((node, i) => {
    const a = n ? (2 * Math.PI * i) / n - Math.PI / 2 : 0;
    pos.set(node.slug, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
  });

  const edges = g.edges
    .map((e) => {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      if (!a || !b) return "";
      const danger = e.type === "supersedes" || e.type === "contradicts";
      return `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${danger ? "#c0392b" : "#cbd5e1"}" stroke-width="1"${danger ? ' stroke-dasharray="4 3"' : ""}><title>${esc(e.type)}: ${esc(label(e.from))} → ${esc(label(e.to))}</title></line>`;
    })
    .join("");

  const dots = g.nodes
    .map((node) => {
      const p = pos.get(node.slug)!;
      const color = TIER_COLOR[node.tier] ?? "#6b7280";
      const ring = node.hasGap
        ? `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="11" fill="none" stroke="#b97e16" stroke-width="2"/>`
        : "";
      const staleStroke = node.stale ? ' stroke="#c0392b" stroke-width="2"' : "";
      return `${ring}<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="6" fill="${color}"${staleStroke}><title>${esc(node.slug)} (${esc(node.type)}, ${esc(node.tier)})${node.stale ? " · stale" : ""}${node.hasGap ? " · gap" : ""}</title></circle><text x="${(p.x + 9).toFixed(1)}" y="${(p.y + 3).toFixed(1)}" font-size="9" fill="#374151">${esc(label(node.slug))}</text>`;
    })
    .join("");

  const legend = [
    ["durable", TIER_COLOR.durable],
    ["derived", TIER_COLOR.derived],
    ["working", TIER_COLOR.working],
  ]
    .map(([t, c], i) => `<circle cx="16" cy="${20 + i * 16}" r="5" fill="${c}"/><text x="26" y="${23 + i * 16}" font-size="10" fill="#374151">${t}</text>`)
    .join("");

  const trunc = g.truncated
    ? `<text x="${W - 12}" y="${H - 10}" font-size="10" fill="#b91c1c" text-anchor="end">+${g.truncated} more nodes not shown</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system,Segoe UI,Roboto,Arial,sans-serif">
  <rect width="${W}" height="${H}" fill="#f9fafb"/>
  <text x="${cx}" y="24" text-anchor="middle" font-size="14" font-weight="700" fill="#1c2024">Vitrus — knowledge graph (${g.nodes.length} nodes · ${g.edges.length} edges)</text>
  <g>${edges}</g>
  <g>${dots}</g>
  ${legend}
  <text x="16" y="${20 + 3 * 16 + 6}" font-size="10" fill="#c0392b">— red dashed = supersede/contradict · amber ring = gap</text>
  ${trunc}
</svg>`;
}

/** Tek-sayfa HTML kabuğu (CLI --html). */
export function renderGraphHtml(g: GraphSnapshot): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Vitrus — Knowledge Graph</title></head><body style="margin:0;background:#f3f4f6">${renderGraphSvg(g)}</body></html>`;
}
