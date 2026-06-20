// src/schema/validate.ts — pack iyi-biçimlilik + donmuş-union kapsama denetimi (deterministik).
import type { SchemaPack } from "./types.js";
import { NODE_TYPES, EDGE_TYPES } from "../core/types.js";

/** Pack iyi-biçimli mi? Deterministik hata listesi döner (boş = geçerli). */
export function validatePack(pack: SchemaPack): string[] {
  const errors: string[] = [];
  if (!pack?.name?.trim()) errors.push("pack.name boş");
  if (!pack?.version?.trim()) errors.push("pack.version boş");
  if (!Array.isArray(pack?.nodeTypes) || !Array.isArray(pack?.edgeTypes)) {
    errors.push("nodeTypes/edgeTypes dizi değil");
    return errors;
  }

  const nodeNames = new Set<string>();
  for (const nt of pack.nodeTypes) {
    if (!nt.name?.trim()) errors.push("isimsiz node tipi");
    else if (nodeNames.has(nt.name)) errors.push(`yinelenen node tipi: ${nt.name}`);
    else nodeNames.add(nt.name);
    if (!nt.description?.trim()) errors.push(`node tipi '${nt.name}' açıklamasız`);
  }

  const edgeNames = new Set<string>();
  for (const et of pack.edgeTypes) {
    if (!et.name?.trim()) errors.push("isimsiz kenar tipi");
    else if (edgeNames.has(et.name)) errors.push(`yinelenen kenar tipi: ${et.name}`);
    else edgeNames.add(et.name);
    if (!et.description?.trim()) errors.push(`kenar tipi '${et.name}' açıklamasız`);
    if (!et.from?.length) errors.push(`kenar '${et.name}' from boş`);
    if (!et.to?.length) errors.push(`kenar '${et.name}' to boş`);
    // from/to bilinen node tipine (veya "*") referans vermeli
    for (const [side, list] of [["from", et.from], ["to", et.to]] as const) {
      for (const t of list ?? []) {
        if (t !== "*" && !nodeNames.has(t)) errors.push(`kenar '${et.name}' ${side}='${t}' bilinmeyen node tipi`);
      }
    }
  }
  return errors;
}

/** Pack donmuş TS union'ını (NODE_TYPES/EDGE_TYPES) TAM kapsıyor mu? Drift tespiti. */
export function coverageGaps(pack: SchemaPack): {
  missingNodeTypes: string[];
  missingEdgeTypes: string[];
  extraNodeTypes: string[];
  extraEdgeTypes: string[];
} {
  const packNodes = new Set(pack.nodeTypes.map((n) => n.name));
  const packEdges = new Set(pack.edgeTypes.map((e) => e.name));
  const canonNodes = new Set<string>(NODE_TYPES);
  const canonEdges = new Set<string>(EDGE_TYPES);
  return {
    missingNodeTypes: [...canonNodes].filter((t) => !packNodes.has(t)),
    missingEdgeTypes: [...canonEdges].filter((t) => !packEdges.has(t)),
    extraNodeTypes: [...packNodes].filter((t) => !canonNodes.has(t)),
    extraEdgeTypes: [...packEdges].filter((t) => !canonEdges.has(t)),
  };
}
