// src/api-hub/retrieve.ts
// Retrieval: göreve en uygun endpoint kartını hibrit aramayla bul (Gorilla retriever).
// type=api_endpoint filtresi engine'de yok → over-fetch + node.type filtresi (kendi-içinde, motor değişmeden).

import type { BrainEngine } from "../core/engine.js";
import type { ApiEndpointCard } from "./types.js";

export interface ApiHit {
  card: ApiEndpointCard;
  score: number;
  slug: string;
}

/** frontmatter.card → ApiEndpointCard (cardToNode'un tersi). */
export function nodeToCard(frontmatter: Record<string, unknown> | undefined): ApiEndpointCard | undefined {
  const c = frontmatter?.card;
  return c && typeof c === "object" && (c as ApiEndpointCard).operationId ? (c as ApiEndpointCard) : undefined;
}

export async function apiSearch(
  engine: BrainEngine,
  task: string,
  opts: { limit?: number; principals?: string[] } = {}
): Promise<ApiHit[]> {
  const limit = opts.limit ?? 5;
  const hits = await engine.search(task, { limit: Math.min(50, limit * 8), principals: opts.principals });
  const out: ApiHit[] = [];
  for (const h of hits) {
    if (h.node.type !== "api_endpoint") continue;
    const card = nodeToCard(h.node.frontmatter);
    if (card) out.push({ card, score: h.score, slug: h.node.slug });
    if (out.length >= limit) break;
  }
  return out;
}

/** ref = operationId VEYA "METHOD /path" → kartı bul (verify/execute için). Yoksa undefined (= halüsinasyon). */
export async function findEndpoint(
  engine: BrainEngine,
  ref: string,
  principals?: string[]
): Promise<ApiEndpointCard | undefined> {
  const want = ref.trim().toLowerCase();
  const hits = await engine.search(ref, { limit: 30, principals });
  let fallback: ApiEndpointCard | undefined;
  for (const h of hits) {
    if (h.node.type !== "api_endpoint") continue;
    const c = nodeToCard(h.node.frontmatter);
    if (!c) continue;
    if (c.operationId.toLowerCase() === want || `${c.method} ${c.path}`.toLowerCase() === want) return c;
    if (!fallback) fallback = c; // top api_endpoint hit (yaklaşık eşleşme)
  }
  return undefined; // tam eşleşme yok → çağıran fallback'i ayrı isteyebilir; tam-yok = halüsinasyon kapısı
}
