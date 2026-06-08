// src/connectors/webhook.ts
// Webhook tabanlı CANLI senkron: kaynaktaki değişiklik olayları (created/updated/
// deleted) bir DEĞİŞİKLİK KUYRUĞUNA alınır ve incremental uygulanır.
//   upsert → putNode (içerik/ACL güncel)   ·   delete → deleteNode (soft-delete)
// Tam fetch (ingest) periyodik + prune; webhook aradaki canlı deltaları taşır.

import type { BrainEngine } from "../core/engine.js";
import type { SourceRecord } from "./types.js";
import { recordToNode } from "./types.js";

export type ChangeAction = "upsert" | "delete";

export interface ChangeEvent {
  connector: string;
  action: ChangeAction;
  record?: SourceRecord; // upsert için
  slug?: string; // delete için
}

/** Tek bir değişikliği uygular (idempotent). */
export async function applyChange(engine: BrainEngine, e: ChangeEvent): Promise<void> {
  if (e.action === "delete" && e.slug) {
    await engine.deleteNode(e.slug);
    return;
  }
  if (e.action === "upsert" && e.record) {
    await engine.putNode(recordToNode(e.connector, e.record));
    return;
  }
}

/** Sıralı, tekrar-uygulanabilir değişiklik kuyruğu. */
export class ChangeQueue {
  private q: ChangeEvent[] = [];
  enqueue(e: ChangeEvent): void {
    this.q.push(e);
  }
  size(): number {
    return this.q.length;
  }
  /** Kuyruğu boşaltıp her olayı sırayla uygular. */
  async drain(engine: BrainEngine): Promise<{ applied: number; upserts: number; deletes: number }> {
    let upserts = 0;
    let deletes = 0;
    while (this.q.length) {
      const e = this.q.shift()!;
      await applyChange(engine, e);
      if (e.action === "upsert") upserts++;
      else deletes++;
    }
    return { applied: upserts + deletes, upserts, deletes };
  }
}

/**
 * Ham webhook yükünü ChangeEvent'e çevirir (genel docs şekli).
 *   { action: "upsert", item: {...} }  veya  { action: "delete", id: "..." }
 */
export function parseWebhook(connector: string, slugPrefix: string, payload: any): ChangeEvent {
  if (payload?.action === "delete" && payload.id) {
    return { connector, action: "delete", slug: `${slugPrefix}${payload.id}` };
  }
  const it = payload?.item;
  if (payload?.action === "upsert" && it?.id) {
    return {
      connector,
      action: "upsert",
      record: {
        sourceId: it.id,
        type: it.type ?? "document",
        tier: "working",
        title: it.title ?? it.id,
        content: it.body ?? "",
        uri: it.url ?? null,
        capturedAt: it.createdAt ?? null,
        acl: [],
        slug: `${slugPrefix}${it.id}`,
      },
    };
  }
  throw new Error("geçersiz webhook yükü");
}
