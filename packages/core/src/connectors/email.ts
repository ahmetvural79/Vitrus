// src/connectors/email.ts
// E-posta ingestion (gbrain "email webhook" paritesi). JSON ihracı (dizi veya {items})
// → her mesaj bir SourceRecord. Katılımcılar (from/to/cc) → ACL (user, fail-closed: yalnız
// katılımcılar görür) + [[durable/people/...]] auto-link. public:true → org-geneli.

import { readFileSync } from "node:fs";
import type { Connector, SourceRecord } from "./types.js";
import type { AclEntry } from "../core/types.js";
import { PUBLIC_PRINCIPAL } from "../core/types.js";

interface EmailMsg {
  id: string;
  from: string;
  to?: string[];
  cc?: string[];
  subject?: string;
  date?: string;
  body: string;
  public?: boolean;
}

/** Kimlik (e-posta/ad) → kişi slug parçası (deterministik). */
export function slugifyPerson(id: string): string {
  const local = id.includes("@") ? id.split("@")[0] : id;
  return local.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

export class EmailConnector implements Connector {
  readonly name = "email";
  readonly slugPrefix = "working/email/";
  constructor(private readonly fixturePath: string) {}

  async fetch(): Promise<SourceRecord[]> {
    const raw = JSON.parse(readFileSync(this.fixturePath, "utf8")) as EmailMsg[] | { items?: EmailMsg[] };
    const items: EmailMsg[] = Array.isArray(raw) ? raw : (raw.items ?? []);
    return items.map((m) => {
      const participants = [...new Set([m.from, ...(m.to ?? []), ...(m.cc ?? [])].filter(Boolean))];
      const acl: AclEntry[] = m.public
        ? [{ kind: "public", principal: PUBLIC_PRINCIPAL }]
        : participants.map((p) => ({ kind: "user" as const, principal: p }));
      const peopleLinks = participants.map((p) => `[[durable/people/${slugifyPerson(p)}]]`).join(" ");
      return {
        sourceId: m.id,
        type: "document",
        tier: "working",
        title: m.subject ?? "(konusuz)",
        content: `${m.body}\n\nKatılımcılar: ${peopleLinks}`,
        uri: null,
        capturedAt: m.date ?? null,
        acl,
        slug: `${this.slugPrefix}${m.id}`,
      };
    });
  }
}
