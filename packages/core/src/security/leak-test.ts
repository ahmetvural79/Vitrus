// src/security/leak-test.ts
// Sızıntı-testi harness'ı — ÜRÜN ÖZELLİĞİ (Glean'e karşı güven hendeği).
// Her özel düğüm × yetkisiz kullanıcı: doc'un KENDİ başlığıyla (adversaryal,
// en olası sızdıran sorgu) arar ve dönMEMEli. Tek sızıntı = kapı başarısız.
//
// Pozitif kontrol: yetkili kullanıcı doc'u görebilmeli — yoksa probe zayıf
// (test anlamsız geçiyor) demektir, raporlanır.

import type { BrainEngine } from "../core/engine.js";
import type { MarkdownStore } from "../store/markdown-store.js";

const OUTSIDER = ["__no_access__"]; // hiçbir ACL'de olmayan principal

export interface LeakCheck {
  doc: string;
  query: string;
  leaked: boolean;
}
export interface LeakReport {
  restrictedDocs: number;
  checks: number;
  leaks: LeakCheck[];
  weakProbes: string[]; // yetkili bile bulamadı → probe zayıf
  ok: boolean;
}

/** Doc'u en çok sızdırabilecek sorgu: başlık + birkaç içerik token'ı. */
function probeQuery(title: string, content: string): string {
  const clean = content.replace(/\[\[[^\]]*\]\]/g, " ").replace(/[#>*`-]/g, " ");
  const toks = clean.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 3).slice(0, 6);
  return [title, ...toks].join(" ");
}

export async function runLeakTest(engine: BrainEngine, store: MarkdownStore): Promise<LeakReport> {
  // Özel doc = ACL'i var ve public DEĞİL (kaynak-üstü markdown ACL'i baz alınır).
  const restricted = store
    .readAll()
    .filter((n) => n.node.acl.length > 0 && !n.node.acl.some((a) => a.kind === "public"));

  const leaks: LeakCheck[] = [];
  const weakProbes: string[] = [];
  let checks = 0;

  for (const r of restricted) {
    const slug = r.node.slug;
    const q = probeQuery(r.node.title, r.node.content);
    const authorized = r.node.acl.map((a) => a.principal);

    // Pozitif kontrol: yetkili görebilmeli (probe anlamlı mı).
    const pos = await engine.search(q, { limit: 25, principals: authorized });
    if (!pos.some((h) => h.node.slug === slug)) weakProbes.push(slug);

    // SIZINTI KAPISI: yetkisiz ASLA görmemeli.
    const out = await engine.search(q, { limit: 25, principals: OUTSIDER });
    checks++;
    const leaked = out.some((h) => h.node.slug === slug);
    if (leaked) leaks.push({ doc: slug, query: q, leaked });
  }

  return { restrictedDocs: restricted.length, checks, leaks, weakProbes, ok: leaks.length === 0 };
}

/** "Test mode" şeffaflık: bir sorgu için dönen + ACL'in eledikleri + principal seti. */
export async function explainSearch(
  engine: BrainEngine,
  query: string,
  principals: string[]
): Promise<{ principals: string[]; returned: string[]; excluded: string[] }> {
  const authed = await engine.search(query, { limit: 25, principals });
  const all = await engine.search(query, { limit: 25 }); // kısıtsız
  const returned = authed.map((h) => h.node.slug);
  const excluded = all.map((h) => h.node.slug).filter((s) => !returned.includes(s));
  return { principals, returned, excluded };
}

export function renderLeakReport(r: LeakReport): string {
  const out: string[] = [];
  out.push(`Leak test · ${r.restrictedDocs} restricted docs · ${r.checks} checks`);
  if (r.leaks.length) {
    out.push(`\n✗ ${r.leaks.length} LEAKS:`);
    for (const l of r.leaks) out.push(`  - ${l.doc}  (query: "${l.query.slice(0, 40)}…")`);
  }
  if (r.weakProbes.length) out.push(`\n⚠ weak probe (even the authorized user couldn't find it): ${r.weakProbes.join(", ")}`);
  out.push(r.ok ? "\n✓ NO LEAKS — gate passed (unauthorized access = 0)" : "\n✗ GATE FAILED");
  return out.join("\n");
}
