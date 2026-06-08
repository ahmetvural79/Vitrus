// src/connectors/mcp-source.ts
// "Mevcut MCP server'larını KAYNAK yap" köprüsü (stratejik: connector yarışını
// ajan-yerellikle kısa devre et — Glean'in 100+ connector'ıyla yarışmak yerine
// ekosistemdeki MCP server'larını bağla).
//
// Yukarı-akış MCP server'ının resource'larını çekip SourceRecord'a çevirir.
// İstemci duck-typed (SDK Client uyumlu) — gerçek server gerektirmeden test edilir.

import type { Connector, SourceRecord } from "./types.js";
import { PUBLIC_PRINCIPAL } from "../core/types.js";

/** SDK Client'ın resource yüzeyiyle uyumlu minimal arayüz. */
export interface McpResourceClient {
  listResources(): Promise<{ resources: { uri: string; name?: string }[] }>;
  readResource(args: { uri: string }): Promise<{ contents: { uri: string; text?: string }[] }>;
}

function slugifyUri(uri: string): string {
  return uri.replace(/^[a-z]+:\/\//i, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

export class McpSourceConnector implements Connector {
  readonly name: string;
  readonly slugPrefix: string;
  constructor(
    sourceName: string,
    private readonly client: McpResourceClient
  ) {
    this.name = `mcp:${sourceName}`;
    this.slugPrefix = `working/${this.name.replace(":", "/")}/`;
  }

  async fetch(): Promise<SourceRecord[]> {
    const { resources } = await this.client.listResources();
    const records: SourceRecord[] = [];
    for (const res of resources) {
      const r = await this.client.readResource({ uri: res.uri });
      const content = r.contents.map((c) => c.text ?? "").join("\n").trim();
      if (!content) continue;
      records.push({
        sourceId: res.uri,
        type: "document",
        tier: "working",
        title: res.name ?? res.uri,
        content,
        uri: res.uri,
        capturedAt: null,
        // Yukarı-akış izin metadata'sı yoksa fail-closed temeli için varsayım
        // yapmıyoruz; burada açık şekilde public işaretliyoruz (dev köprüsü).
        acl: [{ kind: "public", principal: PUBLIC_PRINCIPAL }],
        slug: `working/${this.name.replace(":", "/")}/${slugifyUri(res.uri)}`,
      });
    }
    return records;
  }
}
