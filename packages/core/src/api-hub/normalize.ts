// src/api-hub/normalize.ts
// OpenAPI 3 / Swagger 2 spec → ApiEndpointCard[] → KnowledgeNode (type=api_endpoint). Deterministik, LLM'siz.
// Kart JSON'u frontmatter.card'da saklanır → retrieve geri-parse eder (verify/execute için).

import type { KnowledgeNode } from "../core/types.js";
import { PUBLIC_PRINCIPAL } from "../core/types.js";
import { contentHash } from "../sync/markdown.js";
import type { ApiEndpointCard, ApiParam } from "./types.js";

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

function slugSafe(s: string): string {
  return s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "x";
}

function toParam(p: Record<string, any>): ApiParam | null {
  if (!p || typeof p !== "object" || !p.name) return null;
  const where = ["query", "path", "header", "cookie"].includes(p.in) ? p.in : "query";
  // Swagger 2: tip/enum doğrudan p üstünde; OpenAPI 3: p.schema üstünde.
  const sch = p.schema ?? p;
  return {
    name: String(p.name),
    in: where as ApiParam["in"],
    required: !!p.required || where === "path",
    type: sch?.type ? String(sch.type) : undefined,
    enum: Array.isArray(sch?.enum) ? sch.enum.map(String) : undefined,
    description: p.description ? String(p.description).slice(0, 160) : undefined,
  };
}

function bodyFields(rb: Record<string, any>): string[] | undefined {
  const first = rb?.content ? Object.values(rb.content)[0] : undefined;
  const props = (first as any)?.schema?.properties;
  return props && typeof props === "object" ? Object.keys(props) : undefined;
}

/** OpenAPI 3 (veya tolere edilen Swagger 2) spec'inden endpoint kartları. */
export function normalizeOpenApi(spec: Record<string, any>, apiName?: string): ApiEndpointCard[] {
  const cards: ApiEndpointCard[] = [];
  const name = apiName ?? spec?.info?.title ?? "api";
  const baseUrl =
    Array.isArray(spec?.servers) && spec.servers[0]?.url
      ? String(spec.servers[0].url)
      : spec?.host
        ? `https://${spec.host}${spec.basePath ?? ""}`
        : undefined;
  const paths = spec?.paths ?? {};
  for (const [path, item] of Object.entries(paths)) {
    if (!item || typeof item !== "object") continue;
    const shared = Array.isArray((item as any).parameters) ? (item as any).parameters : [];
    for (const method of METHODS) {
      const op = (item as any)[method];
      if (!op || typeof op !== "object") continue;
      const params = [...shared, ...(Array.isArray(op.parameters) ? op.parameters : [])]
        .map(toParam)
        .filter((p): p is ApiParam => !!p);
      const rb = op.requestBody;
      const requestBody = rb
        ? { required: !!rb.required, contentType: rb.content ? Object.keys(rb.content)[0] : undefined, fields: bodyFields(rb) }
        : undefined;
      // operationId spec TANIMLAYICISI — case korunur (slug ayrıca lowercase'lenir cardToNode'da).
      const opId = String(op.operationId ?? `${method}_${path}`).replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "op";
      cards.push({
        apiName: name,
        operationId: opId,
        method: method.toUpperCase(),
        path,
        baseUrl,
        summary: String(op.summary ?? op.description ?? `${method.toUpperCase()} ${path}`).slice(0, 200),
        description: op.description ? String(op.description) : undefined,
        parameters: params,
        requestBody,
        auth: op.security || spec.security ? "required" : undefined,
        deprecated: !!op.deprecated,
        tags: Array.isArray(op.tags) ? op.tags.map(String) : undefined,
      });
    }
  }
  return cards;
}

/** Kart → retrievable markdown gövdesi (Gorilla "API documentation" — hem insan hem embedding okur). */
export function cardToContent(c: ApiEndpointCard): string {
  const lines: string[] = [
    `# ${c.method} ${c.path}`,
    c.summary,
    "",
    `**API:** ${c.apiName} · **operationId:** \`${c.operationId}\`${c.deprecated ? " · ⚠ DEPRECATED" : ""}`,
  ];
  if (c.baseUrl) lines.push(`**Base:** ${c.baseUrl}`);
  if (c.auth) lines.push(`**Auth:** ${c.auth}`);
  lines.push("", "## Parameters");
  if (c.parameters.length) {
    for (const p of c.parameters)
      lines.push(
        `- \`${p.name}\` (${p.in}${p.required ? ", required" : ""}${p.type ? `, ${p.type}` : ""})${p.enum ? ` — one of ${p.enum.join("|")}` : ""}${p.description ? ` — ${p.description}` : ""}`
      );
  } else lines.push("- (none)");
  if (c.requestBody)
    lines.push(
      "",
      "## Request body",
      `- ${c.requestBody.required ? "required" : "optional"}${c.requestBody.contentType ? ` (${c.requestBody.contentType})` : ""}${c.requestBody.fields ? ` — fields: ${c.requestBody.fields.join(", ")}` : ""}`
    );
  if (c.tags?.length) lines.push("", `tags: ${c.tags.join(", ")}`);
  return lines.join("\n");
}

/** Kart → putNode girdisi. Kart JSON'u frontmatter.card'da (retrieve geri-parse eder). */
export function cardToNode(c: ApiEndpointCard): Omit<KnowledgeNode, "id" | "createdAt" | "updatedAt"> {
  const content = cardToContent(c);
  return {
    slug: `durable/apis/${slugSafe(c.apiName)}/${slugSafe(c.operationId)}`,
    type: "api_endpoint",
    tier: "durable",
    title: `${c.method} ${c.path}`,
    content,
    frontmatter: { api: c.apiName, operationId: c.operationId, method: c.method, path: c.path, card: c },
    salience: 0.6,
    provenance: {
      connector: "api-hub",
      sourceId: `${c.apiName}:${c.operationId}`,
      uri: c.baseUrl ? `${c.baseUrl}${c.path}` : null,
      capturedAt: null,
    },
    acl: [{ kind: "public", principal: PUBLIC_PRINCIPAL }],
    contentHash: contentHash(content),
  };
}
