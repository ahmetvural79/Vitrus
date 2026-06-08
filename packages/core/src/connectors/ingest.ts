// src/connectors/ingest.ts
// Ingest hattı: connector kayıtları → putNode (provenance + ACL + auto-link) →
// prune (kaynakta artık olmayanları soft-delete). İdempotent: aynı sourceId/slug
// upsert; content_hash değişmemişse içerik aynı kalır.

import type { BrainEngine } from "../core/engine.js";
import type { Connector } from "./types.js";
import { recordToNode } from "./types.js";

export interface IngestResult {
  connector: string;
  upserted: number;
  pruned: number;
}

export async function ingest(engine: BrainEngine, connector: Connector): Promise<IngestResult> {
  // Grup üyeliği hattı (doc-ACL'den ayrı, F13) — varsa önce senkronla.
  if (connector.groups) {
    for (const g of await connector.groups()) await engine.setGroupMembers(g.group, g.members);
  }
  const records = await connector.fetch();
  for (const r of records) {
    await engine.putNode(recordToNode(connector.name, r));
  }
  // incremental_sync budaması: bu connector'ın namespace'inde, bu fetch'te
  // görülmeyen eski kayıtları soft-delete (connector alanına göre DEĞİL).
  const pruned = await engine.pruneConnector(
    connector.slugPrefix,
    records.map((r) => r.sourceId)
  );
  return { connector: connector.name, upserted: records.length, pruned };
}
