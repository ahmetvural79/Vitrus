// src/connectors/slack.ts
// Slack connector (read-only). Kanal/thread geçmişini kayda çevirir.
// - thread_ts ile mesajları gruplar → thread başına bir kayıt.
// - <@U..> mention'larını kullanıcı haritasıyla [[durable/people/<ad>]]'e çevirir (auto-link).
// - ACL: kanal (grup) + üyeler (kullanıcı) — izin metadata TOPLANIR (Faz 1'de uygulanır).
//
// Şu an bir Slack EXPORT fixture'ından okur (offline/deterministik). Canlı API
// (conversations.history + pagination + token) ince bir katman olarak eklenir.

import { readFileSync } from "node:fs";
import type { Connector, SourceRecord } from "./types.js";
import type { AclEntry } from "../core/types.js";
import { PUBLIC_PRINCIPAL } from "../core/types.js";

interface SlackMessage { ts: string; user: string; text: string; thread_ts?: string }
interface SlackExport {
  channel: { id: string; name: string; members: string[] };
  users: Record<string, string>; // U0ALICE → alice
  messages: SlackMessage[];
}

function tsToIso(ts: string): string | null {
  const sec = Number(ts.split(".")[0]);
  return Number.isFinite(sec) ? new Date(sec * 1000).toISOString() : null;
}

function mapMentions(text: string, users: Record<string, string>): string {
  return text.replace(/<@(\w+)>/g, (_m, uid: string) =>
    users[uid] ? `[[durable/people/${users[uid]}]]` : `@${uid}`
  );
}

export class SlackConnector implements Connector {
  readonly name = "slack";
  readonly slugPrefix = "working/slack/";
  constructor(private readonly fixturePath: string) {}

  /** Grup üyeliği: kanal → üyeler (kullanıcı adlarına eşlenmiş). */
  async groups(): Promise<{ group: string; members: string[] }[]> {
    const data = JSON.parse(readFileSync(this.fixturePath, "utf8")) as SlackExport;
    return [
      {
        group: `slack:${data.channel.name}`,
        members: data.channel.members.map((u) => data.users[u] ?? u),
      },
    ];
  }

  async fetch(): Promise<SourceRecord[]> {
    const data = JSON.parse(readFileSync(this.fixturePath, "utf8")) as SlackExport;
    const { channel, users, messages } = data;

    // İzin metadata: kanal grubu + üyeler.
    const acl: AclEntry[] = [
      { kind: "group", principal: `slack:${channel.name}` },
      ...channel.members.map((u) => ({ kind: "user" as const, principal: users[u] ?? u })),
    ];
    void PUBLIC_PRINCIPAL; // kanal özel → public DEĞİL (fail-closed temeli)

    // thread_ts (yoksa ts) ile grupla.
    const threads = new Map<string, SlackMessage[]>();
    for (const m of messages) {
      const key = m.thread_ts ?? m.ts;
      (threads.get(key) ?? threads.set(key, []).get(key)!).push(m);
    }

    const records: SourceRecord[] = [];
    for (const [ts, msgs] of threads) {
      const body = msgs
        .map((m) => `${users[m.user] ?? m.user}: ${mapMentions(m.text, users)}`)
        .join("\n");
      const titleRaw = mapMentions(msgs[0].text, users).replace(/\[\[[^\]]*\/([^\]]+)\]\]/g, "$1");
      records.push({
        sourceId: `${channel.id}/${ts}`,
        type: "note",
        tier: "working",
        title: titleRaw.slice(0, 60),
        content: body,
        uri: `https://example.slack.com/archives/${channel.id}/p${ts.replace(".", "")}`,
        capturedAt: tsToIso(ts),
        acl,
        slug: `working/slack/${channel.name}/${ts.replace(".", "-")}`,
      });
    }
    return records;
  }
}
