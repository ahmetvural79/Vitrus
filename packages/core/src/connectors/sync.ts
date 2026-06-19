// src/connectors/sync.ts
// Sync ORKESTRASYONU — dayanıklı iş kuyruğunun (job-queue.ts, Postgres-native) çalıştırdığı
// sync iş primitifi. Bir `sync` işi: connector'ı kur (token env'den) + incremental ingest.
//   - Periyodik: cron → enqueue('sync', {source, repo/channel}) → worker işler.
//   - Webhook-tetikli: Slack event → enqueue('sync', {source:'slack', channel}) (re-fetch).
//   - Crash-recovery + dedup queue'dan gelir (aynı kaynak için tek aktif sync).
//
// NOT: BullMQ + Redis, cloud-api'nin DAĞITIK zamanlama katmanıdır (çok-worker, cron). Çekirdek
// bu durable primitifi sağlar (Redis bağımlılığı YOK); cloud-api onu BullMQ ile sarmalar.

import type { BrainEngine } from "../core/engine.js";
import type { HttpFetch } from "./http.js";
import type { Connector } from "./types.js";
import { GitHubLiveConnector } from "./github-live.js";
import { SlackLiveConnector } from "./slack-live.js";
import { NotionLiveConnector } from "./notion-live.js";
import { LinearLiveConnector } from "./linear-live.js";
import { JiraLiveConnector } from "./jira-live.js";
import { DriveLiveConnector } from "./drive-live.js";
import { GmailLiveConnector } from "./gmail-live.js";
import { ingest, type IngestResult } from "./ingest.js";

export type SyncSource = "github" | "slack" | "notion" | "linear" | "jira" | "drive" | "gmail";

export interface SyncPayload {
  source: SyncSource;
  repo?: string; // github: "owner/name"
  channel?: string; // slack: kanal id
  channelName?: string; // slack: insan-okunur ad (slug)
  site?: string; // jira: "yourco" veya tam URL
  email?: string; // jira: Basic auth kullanıcı
  since?: string; // ISO → incremental (varsa prune kapalı)
  maxPages?: number;
}

/** Token kaynağı (worker env'i). Sync payload'da token TAŞINMAZ (sır kuyruğa yazılmaz). */
export interface SyncEnv {
  GITHUB_TOKEN?: string;
  VITRUS_GITHUB_TOKEN?: string;
  SLACK_TOKEN?: string;
  VITRUS_SLACK_TOKEN?: string;
  NOTION_TOKEN?: string;
  VITRUS_NOTION_TOKEN?: string;
  LINEAR_API_KEY?: string;
  VITRUS_LINEAR_API_KEY?: string;
  JIRA_API_TOKEN?: string;
  VITRUS_JIRA_API_TOKEN?: string;
  GOOGLE_TOKEN?: string;
  DRIVE_TOKEN?: string;
  GMAIL_TOKEN?: string;
  [k: string]: string | undefined;
}

/** Sync payload → connector (token env'den; fetchImpl test injection). */
export function buildConnector(p: SyncPayload, env: SyncEnv, fetchImpl?: HttpFetch): Connector {
  if (p.source === "github") {
    if (!p.repo) throw new Error("sync github: 'repo' gerekli");
    const token = env.VITRUS_GITHUB_TOKEN ?? env.GITHUB_TOKEN;
    if (!token) throw new Error("sync github: GITHUB_TOKEN env gerekli");
    return new GitHubLiveConnector({ repo: p.repo, token, since: p.since, maxPages: p.maxPages, fetchImpl });
  }
  if (p.source === "slack") {
    if (!p.channel) throw new Error("sync slack: 'channel' gerekli");
    const token = env.VITRUS_SLACK_TOKEN ?? env.SLACK_TOKEN;
    if (!token) throw new Error("sync slack: SLACK_TOKEN env gerekli");
    return new SlackLiveConnector({ channel: p.channel, channelName: p.channelName, token, since: p.since, maxPages: p.maxPages, fetchImpl });
  }
  if (p.source === "notion") {
    const token = env.VITRUS_NOTION_TOKEN ?? env.NOTION_TOKEN;
    if (!token) throw new Error("sync notion: NOTION_TOKEN env gerekli");
    return new NotionLiveConnector({ token, since: p.since, maxPages: p.maxPages, fetchImpl });
  }
  if (p.source === "linear") {
    const token = env.VITRUS_LINEAR_API_KEY ?? env.LINEAR_API_KEY;
    if (!token) throw new Error("sync linear: LINEAR_API_KEY env gerekli");
    return new LinearLiveConnector({ token, since: p.since, maxPages: p.maxPages, fetchImpl });
  }
  if (p.source === "jira") {
    if (!p.site || !p.email) throw new Error("sync jira: 'site' ve 'email' gerekli");
    const token = env.VITRUS_JIRA_API_TOKEN ?? env.JIRA_API_TOKEN;
    if (!token) throw new Error("sync jira: JIRA_API_TOKEN env gerekli");
    return new JiraLiveConnector({ site: p.site, email: p.email, token, since: p.since, maxPages: p.maxPages, fetchImpl });
  }
  if (p.source === "drive") {
    const token = env.GOOGLE_TOKEN ?? env.DRIVE_TOKEN;
    if (!token) throw new Error("sync drive: GOOGLE_TOKEN env gerekli");
    return new DriveLiveConnector({ token, since: p.since, maxPages: p.maxPages, fetchImpl });
  }
  if (p.source === "gmail") {
    const token = env.GOOGLE_TOKEN ?? env.GMAIL_TOKEN;
    if (!token) throw new Error("sync gmail: GOOGLE_TOKEN env gerekli");
    return new GmailLiveConnector({ token, since: p.since, maxPages: p.maxPages, fetchImpl });
  }
  throw new Error(`bilinmeyen sync source: ${(p as { source?: string }).source}`);
}

/**
 * Bir sync işini çalıştır: connector kur + incremental ingest. Delta (since) → prune YOK
 * (eskileri silmesin); tam senkron (since yok) → prune açık. Sonra entity/salience tazele.
 */
export async function runSyncJob(
  engine: BrainEngine,
  payload: SyncPayload,
  opts: { env?: SyncEnv; fetchImpl?: HttpFetch } = {}
): Promise<IngestResult> {
  const conn = buildConnector(payload, opts.env ?? (process.env as SyncEnv), opts.fetchImpl);
  const r = await ingest(engine, conn, { prune: !payload.since });
  await engine.refreshEntities();
  await engine.refreshSalience();
  return r;
}

/** sync işi için kararlı dedup anahtarı (aynı kaynak için tek aktif sync). */
export function syncDedupKey(p: SyncPayload): string {
  return `sync:${p.source}:${p.repo ?? p.channel ?? p.site ?? "workspace"}`;
}
