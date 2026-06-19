// src/connectors/slack-live.ts
// Slack CANLI connector — gerçek Web API (token). Fixture connector (slack.ts) ile
// AYNI SourceRecord şeklini üretir (slug/sourceId/ACL/@mention auto-link). Slack
// CURSOR-tabanlı pagination kullanır (response_metadata.next_cursor) → http.paginateCursor
// ile aynı injectable katman (GitHub'ın Link-header pagination'ından farklı şekil; infra genel).
//
// NOT: Slack mantıksal hatayı HTTP 200 + {ok:false,error} ile döndürür → extract'te yakalanır.
// Incremental: `since` (ISO) → conversations.history `oldest`. Bu durumda ingest PRUNE ETMEMELİ.
// Kanal üyelik senkronu (groups) gerçek-API testinde genişletilecek → şimdilik fail-closed
// grup ACL (slack:<kanal>) üyesiz ilan edilir (kimse görmez; güvenli varsayılan).

import type { Connector, SourceRecord } from "./types.js";
import type { AclEntry } from "../core/types.js";
import { type HttpFetch, defaultFetch, paginateCursor } from "./http.js";

const API = "https://slack.com/api";

export interface SlackLiveOpts {
  channel: string; // kanal ID (Cxxxx)
  channelName?: string; // insan-okunur ad (slug + ACL grubu); yoksa channel id
  token: string;
  since?: string; // ISO → conversations.history oldest (incremental)
  fetchImpl?: HttpFetch;
  maxPages?: number;
}

interface SlackMsg {
  ts: string;
  user?: string;
  text?: string;
  thread_ts?: string;
}
interface SlackUser {
  id: string;
  name?: string;
  profile?: { real_name?: string };
}

function tsToIso(ts: string): string | null {
  const sec = Number(ts.split(".")[0]);
  return Number.isFinite(sec) ? new Date(sec * 1000).toISOString() : null;
}

export class SlackLiveConnector implements Connector {
  readonly name = "slack";
  readonly slugPrefix = "working/slack/";
  private readonly fetchImpl: HttpFetch;
  private userMap: Record<string, string> = {};
  constructor(private readonly opts: SlackLiveOpts) {
    this.fetchImpl = opts.fetchImpl ?? defaultFetch;
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.opts.token}`, "user-agent": "vitrus" };
  }
  private channelName(): string {
    return this.opts.channelName ?? this.opts.channel;
  }

  /** <@U..> → kullanıcı adı haritası (users.list, cursor pagination). Bir kez yüklenir. */
  private async loadUsers(): Promise<void> {
    if (Object.keys(this.userMap).length) return;
    const members = (await paginateCursor(
      this.fetchImpl,
      (c) => `${API}/users.list?limit=200${c ? `&cursor=${encodeURIComponent(c)}` : ""}`,
      this.headers(),
      (d) => {
        if (!d.ok) throw new Error(`slack users.list: ${d.error}`);
        return { items: d.members ?? [], nextCursor: d.response_metadata?.next_cursor ?? null };
      },
      { maxPages: this.opts.maxPages }
    )) as SlackUser[];
    for (const u of members) this.userMap[u.id] = u.name ?? u.profile?.real_name ?? u.id;
  }

  private mapMentions(text: string): string {
    return text.replace(/<@(\w+)>/g, (_m, uid: string) =>
      this.userMap[uid] ? `[[durable/people/${this.userMap[uid]}]]` : `@${uid}`
    );
  }

  async fetch(): Promise<SourceRecord[]> {
    await this.loadUsers();
    const oldest = this.opts.since ? String(Date.parse(this.opts.since) / 1000) : "";
    const msgs = (await paginateCursor(
      this.fetchImpl,
      (c) =>
        `${API}/conversations.history?channel=${encodeURIComponent(this.opts.channel)}&limit=200` +
        `${oldest ? `&oldest=${oldest}` : ""}${c ? `&cursor=${encodeURIComponent(c)}` : ""}`,
      this.headers(),
      (d) => {
        if (!d.ok) throw new Error(`slack conversations.history: ${d.error}`);
        return { items: d.messages ?? [], nextCursor: d.response_metadata?.next_cursor ?? null };
      },
      {
        maxPages: this.opts.maxPages,
        onCapped: (p) => console.error(`⚠ slack ${this.channelName()}: maxPages (${p}) doldu — daha fazla mesaj olabilir.`),
      }
    )) as SlackMsg[];

    const name = this.channelName();
    // Kanal özel → fail-closed grup ACL (üyelik senkronu gerçek-API testinde eklenecek).
    const acl: AclEntry[] = [{ kind: "group", principal: `slack:${name}` }];

    // thread_ts (yoksa ts) ile grupla — fixture connector ile birebir aynı.
    const threads = new Map<string, SlackMsg[]>();
    for (const m of msgs) {
      const key = m.thread_ts ?? m.ts;
      (threads.get(key) ?? threads.set(key, []).get(key)!).push(m);
    }

    const records: SourceRecord[] = [];
    for (const [ts, group] of threads) {
      const body = group
        .map((m) => `${this.userMap[m.user ?? ""] ?? m.user ?? "?"}: ${this.mapMentions(m.text ?? "")}`)
        .join("\n");
      const titleRaw = this.mapMentions(group[0].text ?? "").replace(/\[\[[^\]]*\/([^\]]+)\]\]/g, "$1");
      records.push({
        sourceId: `${this.opts.channel}/${ts}`,
        type: "note",
        tier: "working",
        title: titleRaw.slice(0, 60) || `slack ${ts}`,
        content: body,
        uri: `https://slack.com/archives/${this.opts.channel}/p${ts.replace(".", "")}`,
        capturedAt: tsToIso(ts),
        acl,
        slug: `working/slack/${name}/${ts.replace(".", "-")}`,
      });
    }
    return records;
  }
}
