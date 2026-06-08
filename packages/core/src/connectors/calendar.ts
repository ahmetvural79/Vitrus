// src/connectors/calendar.ts
// Takvim ingestion (gbrain "calendar events" paritesi). JSON ihracı (dizi veya {items}/{events})
// → her etkinlik bir SourceRecord (NodeType "meeting"). Katılımcılar → ACL + [[people]] auto-link.
// capturedAt = başlangıç zamanı (tazelik). public:true → org-geneli, değilse katılımcı-özel.

import { readFileSync } from "node:fs";
import type { Connector, SourceRecord } from "./types.js";
import type { AclEntry } from "../core/types.js";
import { PUBLIC_PRINCIPAL } from "../core/types.js";
import { slugifyPerson } from "./email.js";

interface CalEvent {
  id: string;
  title: string;
  start?: string;
  end?: string;
  attendees?: string[];
  description?: string;
  location?: string;
  public?: boolean;
}

export class CalendarConnector implements Connector {
  readonly name = "calendar";
  readonly slugPrefix = "working/calendar/";
  constructor(private readonly fixturePath: string) {}

  async fetch(): Promise<SourceRecord[]> {
    const raw = JSON.parse(readFileSync(this.fixturePath, "utf8")) as
      | CalEvent[]
      | { items?: CalEvent[]; events?: CalEvent[] };
    const items: CalEvent[] = Array.isArray(raw) ? raw : (raw.items ?? raw.events ?? []);
    return items.map((e) => {
      const attendees = [...new Set((e.attendees ?? []).filter(Boolean))];
      const acl: AclEntry[] = e.public
        ? [{ kind: "public", principal: PUBLIC_PRINCIPAL }]
        : attendees.map((a) => ({ kind: "user" as const, principal: a }));
      const links = attendees.map((a) => `[[durable/people/${slugifyPerson(a)}]]`).join(" ");
      const when = e.start ? `\n\nZaman: ${e.start}${e.end ? `–${e.end}` : ""}` : "";
      const loc = e.location ? `\nYer: ${e.location}` : "";
      return {
        sourceId: e.id,
        type: "meeting",
        tier: "working",
        title: e.title,
        content: `${e.description ?? ""}${when}${loc}\n\nKatılımcılar: ${links}`,
        uri: null,
        capturedAt: e.start ?? null,
        acl,
        slug: `${this.slugPrefix}${e.id}`,
      };
    });
  }
}
