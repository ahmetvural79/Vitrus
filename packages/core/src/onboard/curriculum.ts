// src/onboard/curriculum.ts
// M2 — Onboarding/Day-One: bir rol/alan için beyinden DETERMİNİSTİK öğrenme yolu.
// Mevcut search + graph + gap primitifleri üstü (yeni ingestion YOK). Glass-box: her adım kaynaklı;
// belgesiz konular gap olarak işaretli → gap-flywheel (yeni eleman sorusu → boşluk → capture → sonraki daha hızlı).

import type { BrainEngine } from "../core/engine.js";

export interface CurriculumStep {
  slug: string;
  title: string;
  type: string;
  tier: string;
  why: string;
  uri: string | null;
  owners: string[]; // "kime sor" — graf: bu node'a owns ile bağlı kişiler
}
export interface Curriculum {
  role: string;
  steps: CurriculumStep[];
  gaps: { kind: string; message: string }[];
}

// Pedagojik sıra: bağlam → ekip → kişiler → servisler → kararlar → politika → ...
const TYPE_ORDER = ["company", "team", "person", "service", "decision", "policy", "document", "concept", "incident", "meeting", "note"];
const rank = (t: string) => { const i = TYPE_ORDER.indexOf(t); return i < 0 ? TYPE_ORDER.length : i; };
const leaf = (slug: string) => { const p = slug.split("/"); return p[p.length - 1] || slug; };

function whyFor(type: string, role: string): string {
  switch (type) {
    case "company": return "Company context — start here.";
    case "team": return `The team behind "${role}".`;
    case "person": return "A key person to know (and who to ask).";
    case "service": return "A service this area owns or depends on.";
    case "decision": return "A decision that shapes how things work here.";
    case "policy": return "A policy you must follow.";
    case "incident": return "A past incident — learn from it.";
    default: return `Relevant to "${role}".`;
  }
}

export async function buildCurriculum(
  engine: BrainEngine,
  role: string,
  opts: { limit?: number; principals?: string[] } = {}
): Promise<Curriculum> {
  const hits = await engine.search(role, { limit: 30, principals: opts.principals });
  const steps: CurriculumStep[] = hits
    .filter((h) => !["session", "source"].includes(h.node.type))
    .map((h) => ({
      slug: h.node.slug,
      title: h.node.title || leaf(h.node.slug),
      type: h.node.type,
      tier: h.node.tier,
      why: whyFor(h.node.type, role),
      uri: h.node.provenance.uri,
      owners: [] as string[],
    }));
  steps.sort((a, b) => rank(a.type) - rank(b.type) || a.slug.localeCompare(b.slug));
  const ordered = steps.slice(0, opts.limit ?? 12);

  // "kime sor": servis/karar/ekip adımları için owns-bağlı kişiler (graf).
  for (const s of ordered) {
    if (["service", "decision", "team"].includes(s.type)) {
      try {
        const owners = await engine.graphQuery(s.slug, "owns");
        s.owners = owners.filter((o) => o.type === "person").map((o) => leaf(o.slug)).slice(0, 3);
      } catch { /* graf yok → boş */ }
    }
  }

  // gap-flywheel: müfredat node'larıyla örtüşen boşluklar.
  const leaves = ordered.map((s) => leaf(s.slug).toLowerCase());
  const allGaps = await engine.findGaps();
  const gaps = allGaps
    .filter((g) => leaves.some((l) => g.message.toLowerCase().includes(l) || g.relatedNodeIds.some((id) => id.toLowerCase().includes(l))))
    .slice(0, 6)
    .map((g) => ({ kind: g.kind, message: g.message }));

  return { role, steps: ordered, gaps };
}

export function renderCurriculum(c: Curriculum): string {
  const lines = [`Onboarding path — "${c.role}" (${c.steps.length} steps):`, ""];
  c.steps.forEach((s, i) => {
    lines.push(`${String(i + 1).padStart(2)}. [${s.type}] ${s.title}  ·  ${s.slug}`);
    lines.push(`      ${s.why}${s.owners.length ? `  ·  ask: ${s.owners.join(", ")}` : ""}`);
  });
  if (c.gaps.length) {
    lines.push("", "⚠ Not documented yet (ask, then capture with `vitrus capture`):");
    for (const g of c.gaps) lines.push(`  - [${g.kind}] ${g.message}`);
  }
  return lines.join("\n");
}
