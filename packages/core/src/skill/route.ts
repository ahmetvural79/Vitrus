// src/skill/route.ts
// Akıllı skill yönlendirme (F22, AnythingLLM deseni): sorgu başına yalnız İLGİLİ
// skill'leri seç → ajan bağlamına hepsini değil sadece gerekenleri yükle (token tasarrufu).
// Deterministik: name + triggers + description token örtüşmesi.

export interface RoutableSkill {
  name: string;
  description: string;
  triggers: string[];
}

export function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 2)
  );
}

/** Sorguya en ilgili skill'leri (score>0) döndürür, skora göre azalan, en fazla topK. */
export function routeSkills(
  query: string,
  skills: RoutableSkill[],
  topK = 3
): { name: string; score: number }[] {
  const q = tokens(query);
  return skills
    .map((s) => {
      const hay = tokens([s.name.replace(/-/g, " "), s.description, s.triggers.join(" ")].join(" "));
      let overlap = 0;
      for (const t of q) if (hay.has(t)) overlap++;
      // trigger tam eşleşmesi güçlü sinyal.
      const triggerHit = s.triggers.some((t) => q.has(t.toLowerCase())) ? 1 : 0;
      return { name: s.name, score: overlap + 2 * triggerHit };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, topK);
}
