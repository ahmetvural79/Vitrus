// src/sync/wikilinks.ts
// Öz-bağlanan grafın kalbi: markdown gövdesindeki [[...]] referanslarından
// tipli kenarlar çıkarır. LLM çağrısı YOK — saf desen eşleştirme.
// Yapı zaten yazıdadır; graf kendini bağlar.
//
// İki sözdizimi:
//   [[slug]]            → çevredeki fiil ipucundan tip tahmini (yoksa "mentions")
//   [[edge_type::slug]] → açık tipli kenar (ör. [[owns::service/api]],
//                          [[supersedes::durable/decisions/eski-karar]])
// Açık tip, deterministik çelişki tespitini (Faz 1) besler.

import type { TypedEdge, EdgeType } from "../core/types.js";

const WIKILINK = /\[\[([^\]]+)\]\]/g;

const EDGE_TYPES = new Set<EdgeType>([
  "works_at",
  "member_of",
  "reports_to",
  "owns",
  "depends_on",
  "attended",
  "mentions",
  "extends",
  "contradicts",
  "supersedes",
  "decided_by",
  "caused_by",
  "resolved_by",
  "advises",
  "founded",
]);

// Gövdedeki ipucu kelime → kenar tipi (TR + EN). Açık tip yoksa kullanılır.
// NOT: `\b` ASCII sınır olduğundan Türkçe köklerden (ç/ü/ı/ş/ğ/ö) ÖNCE kullanılmaz
// (eşleşmez). TR kökleri sınırsız, EN kelimeleri \b ile yazılır.
// Sıra önemli: daha spesifik desenler önce. reports_to, depends_on'dan ("bağlı")
// önce gelir ki org hiyerarşisi servis bağımlılığıyla karışmasın.
const VERB_TO_EDGE: { pattern: RegExp; type: EdgeType }[] = [
  // NOT: "yöneticisi" bir unvan (isim), ilişkisel fiil değil → over-match yapardı.
  // Gerçek reports_to zaten açık [[reports_to::...]] ile yazılır.
  { pattern: /rapor verir|yönetimine bağlı|\breports?\s+to\b/i, type: "reports_to" },
  { pattern: /çalış|görevli|\bworks?\s+at\b/i, type: "works_at" },
  { pattern: /üyesi|üye|\bmember\s+of\b/i, type: "member_of" },
  { pattern: /sahip|sorumlu|sahibi|\bowns?\b/i, type: "owns" },
  { pattern: /bağımlı|ihtiyaç duyar|\bdepends?\s+on\b/i, type: "depends_on" },
  { pattern: /katıl|toplantı|\battend/i, type: "attended" },
  { pattern: /kur(du|ucu)|\bfounded\b/i, type: "founded" },
  { pattern: /danış|\badvis/i, type: "advises" },
  { pattern: /çeliş|ile çakış|\bcontradic/i, type: "contradicts" },
  { pattern: /geçersiz|eskisinin yerine|yerini al|\bsupersed/i, type: "supersedes" },
  { pattern: /çözüldü|çözen|gideren|\bresolved\s+by\b/i, type: "resolved_by" },
  { pattern: /nedeniyle|kaynaklanı|yol açtı|\bcaused\s+by\b/i, type: "caused_by" },
  { pattern: /karar verildi|kararıyla|kararına göre|\bdecided\s+by\b/i, type: "decided_by" },
  { pattern: /genişlet|dayanı|\bextends?\b/i, type: "extends" },
];

/**
 * Bir düğümün gövdesinden çıkan tipli kenarları döndürür.
 * fromId: kaynak düğüm id'si. Hedefler [[...]] içinden gelir.
 */
export function extractEdges(fromId: string, body: string): TypedEdge[] {
  const edges: TypedEdge[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = WIKILINK.exec(body)) !== null) {
    const inner = match[1].trim();

    // Açık tip sözdizimi: edge_type::slug
    let explicitType: EdgeType | null = null;
    let targetSlug = inner;
    const sep = inner.indexOf("::");
    if (sep !== -1) {
      const candidate = inner.slice(0, sep).trim() as EdgeType;
      if (EDGE_TYPES.has(candidate)) {
        explicitType = candidate;
        targetSlug = inner.slice(sep + 2).trim();
      }
    }

    const toId = slugToId(targetSlug);
    if (!toId || toId === fromId) continue;

    let edgeType: EdgeType;
    if (explicitType) {
      edgeType = explicitType;
    } else {
      // Bağlantının etrafındaki ~80 karakterlik pencereden tip tahmin et.
      // Geri-bağlamı CÜMLE SINIRINDA kes (komşu cümleden fiil sızmasını önler).
      const back = body.slice(Math.max(0, match.index - 80), match.index);
      const boundary = Math.max(
        back.lastIndexOf("."),
        back.lastIndexOf("!"),
        back.lastIndexOf("?"),
        back.lastIndexOf("\n")
      );
      const backTrimmed = boundary >= 0 ? back.slice(boundary + 1) : back;
      const ctx = backTrimmed + body.slice(match.index, match.index + 80);
      edgeType = "mentions";
      for (const { pattern, type } of VERB_TO_EDGE) {
        if (pattern.test(ctx)) {
          edgeType = type;
          break;
        }
      }
    }

    const key = `${toId}:${edgeType}`;
    if (seen.has(key)) continue;
    seen.add(key);

    edges.push({
      fromId,
      toId,
      type: edgeType,
      // Açık/güçlü tipler yüksek güven; "mentions" düşük.
      confidence: edgeType === "mentions" ? 0.7 : explicitType ? 1.0 : 0.9,
    });
  }
  return edges;
}

/** slug → kararlı id. Şimdilik slug'ı normalize eder. */
export function slugToId(slug: string): string {
  return slug.replace(/^\/+|\/+$/g, "").toLowerCase();
}
