// src/connectors/docs.ts
// Genel "belge" connector'ı — Notion / Linear / Jira / Drive gibi kaynakların
// ortak ihraç şeklini (başlık + gövde + yazar + url + zaman + ACL) tek, iyi-test
// edilmiş adaptörle karşılar. Gerçek API'ler kendi yanıtlarını bu şekle map'ler.
//
// Tek bespoke connector yerine config: name + slugPrefix kaynak adından türer.

import { readFileSync } from "node:fs";
import type { Connector, SourceRecord } from "./types.js";
import type { AclEntry, NodeType } from "../core/types.js";
import { PUBLIC_PRINCIPAL } from "../core/types.js";
import { parseAcl } from "../sync/markdown.js";

interface DocItem {
  id: string;
  type?: NodeType;
  title: string;
  body: string;
  author?: string;
  url?: string;
  createdAt?: string;
  acl?: string[]; // per-item: "user:x" | "group:y" | "public"
}
interface DocsExport {
  source: string;
  visibility?: "public" | "private";
  items: DocItem[];
}

export class DocsConnector implements Connector {
  readonly name: string;
  readonly slugPrefix: string;
  constructor(source: string, private readonly fixturePath: string) {
    this.name = source;
    this.slugPrefix = `working/${source}/`;
  }

  async fetch(): Promise<SourceRecord[]> {
    const data = JSON.parse(readFileSync(this.fixturePath, "utf8")) as DocsExport;
    const defaultAcl: AclEntry[] =
      data.visibility === "public"
        ? [{ kind: "public", principal: PUBLIC_PRINCIPAL }]
        : [{ kind: "group", principal: `${this.name}:workspace` }];

    return data.items.map((it) => {
      const acl = it.acl && it.acl.length ? parseAcl(it.acl.join(",")) : defaultAcl;
      const author = it.author ? `\n\nYazar: [[durable/people/${it.author}]]` : "";
      return {
        sourceId: it.id,
        type: it.type ?? "document",
        tier: "working",
        title: it.title,
        content: `${it.body}${author}`,
        uri: it.url ?? null,
        capturedAt: it.createdAt ?? null,
        acl,
        slug: `${this.slugPrefix}${it.id}`,
      };
    });
  }
}
