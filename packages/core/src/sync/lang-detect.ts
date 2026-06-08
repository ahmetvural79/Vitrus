// src/sync/lang-detect.ts
// Deterministik dil tespiti (LLM'siz) — TR/EN ayrımı. Türkçe'ye özgü harfler +
// yüksek-frekanslı stopword'lerle skorlar. Çok-dilli beyinde düğüm içeriğinin ve
// sorgunun dilini etiketler; sinyal yoksa "und" (undetermined).
// Glass-box: saf fonksiyon, tekrarlanabilir. Üretimde daha zengin bir dedektör
// (ör. fastText) aynı imzadan takılabilir; sözleşme string ISO-benzeri kod döner.

const TR_CHARS = /[çğıöşüÇĞİÖŞÜ]/;
const TR_STOP = new Set([
  "ve", "bir", "bu", "için", "ile", "da", "de", "mi", "ne", "çok", "ama",
  "gibi", "olarak", "var", "yok", "nasıl", "neden", "kim", "değil", "daha",
]);
const EN_STOP = new Set([
  "the", "and", "to", "of", "in", "is", "for", "with", "on", "that", "this",
  "how", "why", "not", "are", "was", "by", "from", "which", "who",
]);

function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}]+/u).filter((t) => t.length > 1);
}

/**
 * "tr" | "en" | "und". Türkçe'ye özgü harf (ç/ğ/ı/ö/ş/ü) kısa metinde bile güçlü
 * TR sinyalidir; aksi halde stopword sayısı belirler. Sinyal yoksa "und".
 */
export function detectLanguage(text: string): string {
  if (!text || !text.trim()) return "und";
  let tr = 0;
  let en = 0;
  for (const t of tokens(text)) {
    if (TR_STOP.has(t)) tr++;
    if (EN_STOP.has(t)) en++;
  }
  if (TR_CHARS.test(text)) tr += 2; // Türkçe harf = güçlü sinyal
  if (tr === 0 && en === 0) return "und";
  return tr >= en ? "tr" : "en";
}
