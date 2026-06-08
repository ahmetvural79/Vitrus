// src/mcp/server.ts
// Katman 3 — MCP server. Resmi SDK (düşük-seviye Server) + JSON Schema tool'lar.
// İki transport: stdio (yerel, Claude Code/Cursor) + Streamable HTTP (ağ).
// NOT: SSE transport DEPRECATED — Streamable HTTP kullanılır.
//
// Resource: vitrus://node/<slug> → düğümün Markdown içeriği (provenance hedefi);
// tool sonuçlarındaki resource_link'ler buraya çözülür.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from "node:http";
import type { BrainEngine } from "../core/engine.js";
import { TOOL_DEFS, callTool, nodeUri, type ToolContext, type MemoryStore } from "./tools.js";
import { protectedResourceMetadata, extractBearer, type TokenVerifier } from "./auth.js";

// Per-tenant tüketiciler (apps/cloud-api) için tip yeniden-ihracı — MCP SDK'ya dokunmadan.
export type { ToolContext, MemoryStore } from "./tools.js";

const NODE_PREFIX = "vitrus://node/";

export function createMcpServer(engine: BrainEngine, ctx: ToolContext = {}): Server {
  const server = new Server(
    { name: "vitrus", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } }
  );

  // --- tools ---
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFS.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      outputSchema: t.outputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const r = await callTool(engine, name, (args ?? {}) as Record<string, unknown>, ctx);
    return { content: r.content, structuredContent: r.structuredContent, isError: r.isError };
  });

  // --- resources (provenance hedefi) ---
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }));

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: [
      {
        uriTemplate: `${NODE_PREFIX}{slug}`,
        name: "node",
        description: "Bir bilgi düğümünün git-Markdown içeriği (slug ile).",
        mimeType: "text/markdown",
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = req.params.uri;
    if (!uri.startsWith(NODE_PREFIX)) throw new Error(`bilinmeyen resource: ${uri}`);
    const slug = decodeURIComponent(uri.slice(NODE_PREFIX.length));
    const node = await engine.getNode(slug, ctx.principals); // ACL: yetkisiz → bulunamadı
    if (!node) throw new Error(`düğüm bulunamadı: ${slug}`);
    return {
      contents: [{ uri: nodeUri(node.slug), mimeType: "text/markdown", text: node.content }],
    };
  });

  return server;
}

/** stdio transport (yerel ajanlar). stdout YALNIZ JSON-RPC — loglar stderr'e. */
export async function runStdio(engine: BrainEngine, store?: MemoryStore): Promise<void> {
  const server = createMcpServer(engine, { store });
  await server.connect(new StdioServerTransport());
}

export interface HttpAuthOptions {
  /** Verilirse OAuth 2.1 Resource Server modu: Bearer doğrulama + ACL akışı. */
  verifier?: TokenVerifier;
  /** Bu kaynağın tanımlayıcısı (token aud'u buna eşit olmalı — RFC 8707). */
  resource?: string;
  /** Authorization Server URL'leri (PRM'de ilan edilir). */
  authServers?: string[];
  /** Ajan-yazma markdown kaynağı (VITRUS_BRAIN) — remember/forget sahipliği. */
  store?: MemoryStore;
}

/**
 * Streamable HTTP transport (ağ). STATELESS: her istek için taze server+transport.
 * verifier verilirse OAuth 2.1 KAYNAK SUNUCUSU: .well-known/oauth-protected-resource +
 * Bearer doğrulama + doğrulanan kimlik → expandPrincipals → ACL filtresi (her istek).
 * NOT: kullanıcının token'ı upstream'e GEÇİRİLMEZ (motor kendi erişimini kullanır).
 */
export async function runHttp(engine: BrainEngine, port: number, auth: HttpAuthOptions = {}): Promise<HttpServer> {
  const resource = auth.resource ?? `http://localhost:${port}/mcp`;
  const PRM_PATH = "/.well-known/oauth-protected-resource";
  const prmUrl = `http://localhost:${port}${PRM_PATH}`;

  const http = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Korumalı kaynak metadata'sı (auth gerektirmez).
    if (req.method === "GET" && req.url === PRM_PATH) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(protectedResourceMetadata(resource, auth.authServers ?? [])));
      return;
    }
    if (!req.url || !req.url.startsWith("/mcp")) {
      res.writeHead(404).end();
      return;
    }

    // Auth: verifier varsa Bearer zorunlu → kimlik → principals. store her durumda akar.
    let ctx: ToolContext = { store: auth.store };
    if (auth.verifier) {
      const token = extractBearer(req);
      const identity = token ? await auth.verifier.verify(token) : null;
      if (!identity) {
        res.writeHead(401, {
          "WWW-Authenticate": `Bearer resource_metadata="${prmUrl}"`,
          "content-type": "application/json",
        });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      ctx = { principals: await engine.expandPrincipals(identity.user), store: auth.store };
    }

    let body: unknown;
    if (req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8");
      body = raw ? JSON.parse(raw) : undefined;
    }
    const server = createMcpServer(engine, ctx);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  });
  await new Promise<void>((resolve) => http.listen(port, resolve));
  return http;
}

/**
 * Tek bir MCP HTTP isteğini ver — ÇOK-KİRACILI köprü. Çağıran, isteğe ait kiracının
 * engine'ini (D1 org-scoped) ve ctx'ini (principals = ACL) seçer; bu fonksiyon yalnız o
 * istek için taze server+transport kurup yanıtlar (STATELESS, runHttp ile aynı desen).
 * apps/cloud-api `/t/<org>/mcp` yönlendirmesinde kullanır (MCP SDK'yı core'da tutar).
 */
export async function serveMcpRequest(
  engine: BrainEngine,
  ctx: ToolContext,
  req: IncomingMessage,
  res: ServerResponse,
  body: unknown
): Promise<void> {
  const server = createMcpServer(engine, ctx);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
