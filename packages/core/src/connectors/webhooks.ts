// src/connectors/webhooks.ts
// Kaynak-spesifik webhook PARSER'ları → ChangeEvent[] (canlı delta hattı, webhook.ts).
// Tam-sync (connector) ile AYNI eşleme fonksiyonlarını kullanır → slug/sourceId çakışmaz:
// webhook deltası, periyodik tam-sync'in ürettiği düğümü tam üzerine yazar (idempotent).
//
// GitHub: issue/PR event'leri DOĞRUDAN ChangeEvent (her öğe bağımsız düğüm; webhook tam veri taşır).
// Slack: thread parçalanmasını önlemek için webhook DOĞRUDAN değil, SYNC job tetikler (cli'da) —
// burada yalnız event'ten kanal id'sini çıkaran yardımcı var.

import type { ChangeEvent } from "./webhook.js";
import { githubAcl, githubItemToRecord, type GhItem } from "./github-live.js";

/** GitHub webhook action'ı → silme mi? (issue/PR kapanış DEĞİL — yalnız 'deleted'). */
const DELETE_ACTIONS = new Set(["deleted"]);

/**
 * GitHub `issues` / `pull_request` webhook yükünü ChangeEvent'e çevirir.
 * Beklenen şekil: { action, issue?|pull_request?, repository: { full_name, private } }.
 * 'deleted' → delete; diğer action'lar (opened/edited/closed/reopened/...) → upsert.
 */
export function parseGitHubWebhook(payload: any): ChangeEvent[] {
  const repo: string | undefined = payload?.repository?.full_name;
  if (!repo) throw new Error("github webhook: repository.full_name yok");
  const isPrivate = !!payload?.repository?.private;
  const acl = githubAcl(isPrivate, repo);
  const action: string = payload?.action ?? "";

  const isPr = !!payload?.pull_request;
  const obj = payload?.issue ?? payload?.pull_request;
  if (!obj || typeof obj.number !== "number") throw new Error("github webhook: issue/pull_request objesi yok");

  const slug = `working/github/${repo}/${obj.number}`;
  if (DELETE_ACTIONS.has(action)) {
    return [{ connector: "github", action: "delete", slug }];
  }

  const item: GhItem = {
    number: obj.number,
    title: obj.title ?? `#${obj.number}`,
    body: obj.body ?? "",
    html_url: obj.html_url ?? "",
    created_at: obj.created_at ?? obj.updated_at ?? "",
    user: obj.user ? { login: obj.user.login } : null,
  };
  return [{ connector: "github", action: "upsert", record: githubItemToRecord(repo, item, acl, isPr) }];
}

/** Slack Events API yükünden kanal id'sini çıkarır (webhook → sync job tetikleme için). */
export function slackWebhookChannel(payload: any): string | null {
  return payload?.event?.channel ?? payload?.channel_id ?? null;
}
