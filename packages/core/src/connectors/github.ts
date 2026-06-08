// src/connectors/github.ts
// GitHub connector (read-only). Issue/PR/discussion'ları kayda çevirir.
// - Yazarı [[durable/people/<author>]] olarak bağlar (auto-link).
// - ACL: repo görünürlüğü (public → public; private → grup repo).
//
// Şu an bir GitHub EXPORT fixture'ından okur. Canlı API (Octokit + token +
// pagination) ince bir katman olarak eklenir.

import { readFileSync } from "node:fs";
import type { Connector, SourceRecord } from "./types.js";
import type { AclEntry, NodeType } from "../core/types.js";
import { PUBLIC_PRINCIPAL } from "../core/types.js";

interface GitHubItem {
  number: number;
  type: "issue" | "pr" | "discussion";
  title: string;
  body: string;
  author: string;
  url: string;
  createdAt: string;
}
interface GitHubExport {
  repo: string; // "org/api-gateway"
  visibility: "public" | "private";
  items: GitHubItem[];
}

export class GitHubConnector implements Connector {
  readonly name = "github";
  readonly slugPrefix = "working/github/";
  constructor(private readonly fixturePath: string) {}

  async fetch(): Promise<SourceRecord[]> {
    const data = JSON.parse(readFileSync(this.fixturePath, "utf8")) as GitHubExport;
    const acl: AclEntry[] =
      data.visibility === "public"
        ? [{ kind: "public", principal: PUBLIC_PRINCIPAL }]
        : [{ kind: "group", principal: `github:${data.repo}` }];

    return data.items.map((it) => {
      const type: NodeType = it.type === "pr" ? "document" : "note";
      const content = `${it.body}\n\nYazar: [[durable/people/${it.author}]] · ${data.repo}#${it.number}`;
      return {
        sourceId: `${data.repo}#${it.number}`,
        type,
        tier: "working",
        title: it.title,
        content,
        uri: it.url,
        capturedAt: it.createdAt,
        acl,
        slug: `working/github/${data.repo}/${it.number}`,
      };
    });
  }
}
