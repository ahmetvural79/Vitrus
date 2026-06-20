// src/schema/explain.ts — bir tipi (node/edge) şema paketinden açıkla (schema_explain_type MCP aracı).
import type { SchemaPack, TypeExplanation } from "./types.js";

/** Tip adını (node veya edge) açıkla; bilinmiyorsa null. */
export function explainType(pack: SchemaPack, typeName: string): TypeExplanation | null {
  const nt = pack.nodeTypes.find((n) => n.name === typeName);
  if (nt) {
    // Bu node tipinin katıldığı kenarlar (kaynak/hedef olarak; "*" her tipe açık).
    const edgesAsFrom = pack.edgeTypes
      .filter((e) => e.from.includes(typeName) || e.from.includes("*"))
      .map((e) => ({ type: e.name, to: e.to }));
    const edgesAsTo = pack.edgeTypes
      .filter((e) => e.to.includes(typeName) || e.to.includes("*"))
      .map((e) => ({ type: e.name, from: e.from }));
    return { name: nt.name, kind: "node", description: nt.description, tierHint: nt.tierHint, slugPattern: nt.slugPattern, edgesAsFrom, edgesAsTo };
  }
  const et = pack.edgeTypes.find((e) => e.name === typeName);
  if (et) {
    return { name: et.name, kind: "edge", description: et.description, from: et.from, to: et.to, inferredVerbs: et.inferredVerbs };
  }
  return null;
}
