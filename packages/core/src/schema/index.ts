// src/schema/index.ts — M3.7 Schema packs v1 genel API.
export * from "./types.js";
export { VITRUS_BASE_PACK } from "./base.js";
export { validatePack, coverageGaps } from "./validate.js";
export { explainType } from "./explain.js";
export { schemaLint } from "./lint.js";

import type { SchemaPack } from "./types.js";
import { validatePack } from "./validate.js";

/** Plain objeden (JSON / YAML→obje) pack yükle: doğrula, geçersizse fırlat. v2: YAML dosya okuma. */
export function loadPack(obj: unknown): SchemaPack {
  const pack = obj as SchemaPack;
  const errors = validatePack(pack);
  if (errors.length) throw new Error(`Geçersiz şema paketi: ${errors.join("; ")}`);
  return pack;
}
