// src/verify/verify.ts
// D1 — verify(claim): "asla self-report'a güvenme" (Garry Tan #3). Ajanın ÖNE SÜRDÜĞÜ bir
// iddiayı Vitrus'ın DETERMİNİSTİK kaydına karşı kontrol eder: kaynaklı (grounded) /
// çelişik (contradicted) / bayat (stale) / desteksiz (unsupported). "Kontrolü dışarı
// verirken bırak, içeri alırken geri kazan" — ajan ne derse desin Vitrus kendi
// deterministik koduyla yeniden bakar. Glass-box: LLM yok; search + findGaps üstüne kurulu.

import type { BrainEngine } from "../core/engine.js";

export type VerifyStatus = "grounded" | "stale" | "contradicted" | "unsupported";

export interface VerifyResult {
  claim: string;
  status: VerifyStatus;
  support: { slug: string; title: string; score: number }[]; // iddiayı lexical olarak destekleyen kaynaklar (title = okunur etiket)
  conflicts: { slug: string; title: string; kind: "contradiction" | "stale" }[];
  confidence: number; // 0..1
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 2)
  );
}

export async function verifyClaim(
  engine: Pick<BrainEngine, "search" | "findGaps">,
  claim: string,
  opts: { limit?: number; supportThreshold?: number; principals?: string[] } = {}
): Promise<VerifyResult> {
  const limit = opts.limit ?? 8;
  const threshold = opts.supportThreshold ?? 0.4;
  const ct = tokens(claim);

  // Aday kanıt: ACL akar (ajan yalnız görebildiğine karşı doğrular).
  const hits = await engine.search(claim, { limit, principals: opts.principals });
  const support = hits
    .map((h) => {
      const ht = tokens(h.node.content);
      let inter = 0;
      for (const t of ct) if (ht.has(t)) inter++;
      return { slug: h.node.slug, id: h.node.id, title: h.node.title, score: ct.size ? Math.round((inter / ct.size) * 1000) / 1000 : 0 };
    })
    .filter((x) => x.score >= threshold)
    .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));

  const gaps = await engine.findGaps();
  const contradictionIds = new Set(gaps.filter((g) => g.kind === "contradiction").flatMap((g) => g.relatedNodeIds));
  // stale gap relatedNodeIds[0] = süpersede EDİLEN (e.toId); süpersede EDEN'i bayat sayma.
  const staleIds = new Set(gaps.filter((g) => g.kind === "stale").map((g) => g.relatedNodeIds[0]).filter(Boolean));

  const conflicts: VerifyResult["conflicts"] = [];
  for (const s of support) {
    if (contradictionIds.has(s.id)) conflicts.push({ slug: s.slug, title: s.title, kind: "contradiction" });
    else if (staleIds.has(s.id)) conflicts.push({ slug: s.slug, title: s.title, kind: "stale" });
  }

  let status: VerifyStatus;
  if (support.length === 0) status = "unsupported";
  else if (conflicts.some((c) => c.kind === "contradiction")) status = "contradicted";
  else if (conflicts.some((c) => c.kind === "stale")) status = "stale";
  else status = "grounded";

  const top = support[0]?.score ?? 0;
  const confidence = status === "unsupported" ? 0 : Math.round(top * (conflicts.length ? 0.5 : 1) * 1000) / 1000;

  return { claim, status, support: support.map(({ slug, title, score }) => ({ slug, title, score })), conflicts, confidence };
}

export function renderVerify(r: VerifyResult): string {
  const icon = { grounded: "✓", stale: "⚠", contradicted: "✗", unsupported: "∅" }[r.status];
  const out: string[] = [`🔎 verify · "${r.claim}"`, "", `STATUS: ${icon} ${r.status} · confidence ${Math.round(r.confidence * 100)}%`];
  if (r.support.length) {
    out.push("supporting sources:");
    for (const s of r.support) out.push(`  [${s.score}] ${s.slug}`);
  } else {
    out.push("  (no source in the brain supports this claim — do not trust the self-report)");
  }
  for (const c of r.conflicts) out.push(`  ⚠ ${c.kind}: ${c.slug}`);
  return out.join("\n");
}
