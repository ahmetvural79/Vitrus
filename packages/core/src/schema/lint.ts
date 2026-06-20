// src/schema/lint.ts — beyni şema paketine karşı deterministik denetle (schema_lint MCP aracı).
// Bilinmeyen node/edge tipi + kenar from→to ihlali. graphSnapshot üstünde (limit → truncated bildirilir).
import type { BrainEngine } from "../core/engine.js";
import type { SchemaPack, SchemaLintFinding, SchemaLintReport } from "./types.js";

export async function schemaLint(
  engine: BrainEngine,
  pack: SchemaPack,
  opts: { limit?: number } = {}
): Promise<SchemaLintReport> {
  const snap = await engine.graphSnapshot({ limit: opts.limit ?? 1000 });
  const slugType = new Map(snap.nodes.map((n) => [n.slug, n.type as string]));
  const nodeTypes = new Set(pack.nodeTypes.map((n) => n.name));
  const edgeMap = new Map(pack.edgeTypes.map((e) => [e.name, e]));
  const findings: SchemaLintFinding[] = [];

  for (const n of snap.nodes) {
    if (!nodeTypes.has(n.type as string)) {
      findings.push({ kind: "unknown_node_type", slug: n.slug, message: `"${n.slug}" tipi '${n.type}' pakette (${pack.name}) tanımsız.` });
    }
  }

  for (const e of snap.edges) {
    const def = edgeMap.get(e.type as string);
    if (!def) {
      findings.push({ kind: "unknown_edge_type", edge: { from: e.from, to: e.to, type: e.type as string }, message: `'${e.type}' kenarı pakette tanımsız (${e.from} → ${e.to}).` });
      continue;
    }
    const ft = slugType.get(e.from);
    const tt = slugType.get(e.to);
    if (ft && !def.from.includes("*") && !def.from.includes(ft)) {
      findings.push({ kind: "edge_from_violation", edge: { from: e.from, to: e.to, type: e.type as string }, message: `'${e.type}' kaynağı '${ft}' olamaz (izinli: ${def.from.join("/")}). [${e.from}]` });
    }
    if (tt && !def.to.includes("*") && !def.to.includes(tt)) {
      findings.push({ kind: "edge_to_violation", edge: { from: e.from, to: e.to, type: e.type as string }, message: `'${e.type}' hedefi '${tt}' olamaz (izinli: ${def.to.join("/")}). [${e.to}]` });
    }
  }

  return { pack: pack.name, findings, scannedNodes: snap.nodes.length, scannedEdges: snap.edges.length, truncated: snap.truncated };
}
