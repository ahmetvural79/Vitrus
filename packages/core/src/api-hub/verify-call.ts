// src/api-hub/verify-call.ts
// DETERMİNİSTİK çağrı doğrulama — Gorilla'nın AST sub-tree matching'inin Vitrus karşılığı.
// "Halüsinasyon" = registry'de OLMAYAN endpoint çağrısı; "error" = var ama yanlış argüman.
// LLM YOK: kart şemasına karşı saf kontrol. Ajan çağırmadan ÖNCE bu kapıdan geçer.

import type { ApiEndpointCard, ApiCallVerdict } from "./types.js";

function typeMatches(t: string, v: unknown): boolean {
  switch (t) {
    case "integer":
    case "number":
      return typeof v === "number" || (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)));
    case "boolean":
      return typeof v === "boolean" || v === "true" || v === "false";
    case "array":
      return Array.isArray(v);
    case "object":
      return typeof v === "object" && v !== null && !Array.isArray(v);
    default:
      return true; // string vs. → kabul
  }
}

/**
 * Kart + önerilen argümanlar → verdict. card yoksa → unknown_endpoint (halüsinasyon).
 * Sıra: eksik-zorunlu → yanlış-tip → uydurma-arg → deprecated → valid.
 */
export function verifyApiCall(card: ApiEndpointCard | undefined, args: Record<string, unknown> = {}): ApiCallVerdict {
  if (!card)
    return { status: "unknown_endpoint", ok: false, issues: ["endpoint not found in the registry (possible hallucination)"] };

  const issues: string[] = [];
  const known = new Set<string>(card.parameters.map((p) => p.name));
  for (const f of card.requestBody?.fields ?? []) known.add(f);

  // 1) eksik zorunlu param
  const missing: string[] = [];
  for (const p of card.parameters) if (p.required && !(p.name in args)) missing.push(`missing required param: ${p.name}`);
  if (card.requestBody?.required) {
    const fields = card.requestBody.fields ?? [];
    const hasBody = "body" in args || fields.some((f) => f in args);
    if (!hasBody) missing.push("missing required request body");
  }

  // 2) yanlış tip / enum
  const wrong: string[] = [];
  for (const p of card.parameters) {
    if (!(p.name in args)) continue;
    const v = args[p.name];
    if (p.type && !typeMatches(p.type, v)) wrong.push(`${p.name}: expected ${p.type}, got ${Array.isArray(v) ? "array" : typeof v}`);
    if (p.enum && p.enum.length && !p.enum.includes(String(v))) wrong.push(`${p.name}: must be one of ${p.enum.join("|")}`);
  }

  // 3) uydurma (spec'te olmayan) arg
  const unknown = Object.keys(args).filter((k) => !known.has(k) && k !== "body");

  issues.push(...missing, ...wrong, ...unknown.map((u) => `unknown arg (not in spec): ${u}`));

  let status: ApiCallVerdict["status"] = "valid";
  if (missing.length) status = "missing_args";
  else if (wrong.length) status = "wrong_type";
  else if (unknown.length) status = "unknown_args";
  else if (card.deprecated) status = "deprecated";

  return { status, ok: status === "valid" || status === "deprecated", endpoint: card.operationId, issues };
}

/** İnsan-okunur verdict satırı (CLI/MCP). */
export function renderVerdict(v: ApiCallVerdict, ref?: string): string {
  const icon = v.ok ? (v.status === "deprecated" ? "⚠" : "✓") : "✗";
  const head = `${icon} ${ref ?? v.endpoint ?? "call"} → ${v.status}`;
  return v.issues.length ? `${head}\n  - ${v.issues.join("\n  - ")}` : head;
}
