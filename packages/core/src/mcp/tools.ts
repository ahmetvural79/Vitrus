// src/mcp/tools.ts
// MCP tool yüzeyi (Katman 3). Transport'tan bağımsız — test edilebilir.
// Her tool: JSON Schema inputSchema + outputSchema (yapısal sonuç) + sonuçta
// resource_link (git-Markdown kaynağa: vitrus://node/<slug> + dış uri).

import type { BrainEngine } from "../core/engine.js";
import type { KnowledgeNode, TypedEdge, AclEntry, NodeType, EdgeType } from "../core/types.js";
import { buildSurface } from "../surface/surface.js";
import { explainFactors } from "../search/explain.js";
import { skillFileToMarkdown } from "../skill/skill-file.js";
import { skillToBundle, slugifyName } from "../skill/skill-export.js";
import { validateSkillFile } from "../skill/skill-file.js";
import { verifyClaim, renderVerify } from "../verify/verify.js";
import { parseAcl, contentHash, slugToId } from "../sync/markdown.js";

export interface McpToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

export interface ToolCallResult {
  content: unknown[];
  structuredContent?: unknown;
  isError?: boolean;
}

/** Bir düğüm slug'ı için MCP resource URI'si (ReadResource ile içeriği okunur). */
export const nodeUri = (slug: string): string => `vitrus://node/${slug}`;

function resourceLink(slug: string, externalUri: string | null) {
  return {
    type: "resource_link",
    uri: externalUri ?? nodeUri(slug),
    name: slug,
    description: externalUri ? "kaynak (dış bağlantı)" : "kaynak (git-Markdown düğüm)",
  };
}
function text(t: string) {
  return { type: "text", text: t };
}

// Tüm tool sonuçları "kaynak gösterir" — glass-box yüzeyini ajan tarafına taşır.
export const TOOL_DEFS: McpToolDef[] = [
  {
    name: "search",
    title: "Hibrit arama",
    description:
      "Şirket beyninde hibrit arama (vektör + BM25 + RRF). LLM çağrısı yok, hızlı. Ham kaynakları + skorları döndürür.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "arama sorgusu" },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
        explain: { type: "boolean", default: false, description: "her sonuç için skor faktör dökümü (vector/bm25/entity sırası + boost'lar) ekle" },
      },
      required: ["query"],
    },
    outputSchema: {
      type: "object",
      properties: {
        hits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              slug: { type: "string" },
              score: { type: "number" },
              vectorRank: { type: ["integer", "null"] },
              bm25Rank: { type: ["integer", "null"] },
              cosine: { type: ["number", "null"] },
              explanation: { type: "array", items: { type: "string" }, description: "explain=true ise skor faktör dökümü" },
            },
            required: ["slug", "score"],
          },
        },
      },
      required: ["hits"],
    },
  },
  {
    name: "think",
    title: "Sentez + boşluk analizi",
    description:
      "Sorguya sentezlenmiş, kaynaklı cevap + 'beynin bilmediği' (boşluk analizi) + güvenilirlik (güven skoru, en eski kaynak). Görünürlük yüzeyini besler.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    outputSchema: {
      type: "object",
      properties: {
        answer: { type: "string" },
        sources: { type: "array", items: { type: "object" } },
        gaps: { type: "array", items: { type: "object" } },
        cards: { type: "object" },
        mode: { type: "string" },
      },
      required: ["answer", "sources", "gaps", "cards"],
    },
  },
  {
    name: "gap_report",
    title: "Boşluk raporu",
    description:
      "Korpus genelindeki boşlukları döndürür: eksik (belgelenmemiş), çelişki, bayat (süpersede), tek-nokta riski, kaynaksız. Deterministik.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        gaps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: { type: "string" },
              message: { type: "string" },
              relatedNodeIds: { type: "array", items: { type: "string" } },
            },
            required: ["kind", "message"],
          },
        },
      },
      required: ["gaps"],
    },
  },
  {
    name: "ops_report",
    title: "Operasyonel verimsizlik haritası",
    description:
      "Şirketi sistem olarak okuyup operasyonel verimsizlikleri döndürür: unowned (sahipsiz servis), bus_factor (tek-kişiye bağlı), bottleneck (aşırı yüklenmiş kişi/ekip), broken_handoff (bayat şeye bağımlılık). Tipli kenarlardan DETERMİNİSTİK türetilir (LLM yok). Şiddete göre sıralı.",
    inputSchema: {
      type: "object",
      properties: { bottleneckThreshold: { type: "integer", minimum: 2, description: "bottleneck eşiği (varsayılan 4)" } },
    },
    outputSchema: {
      type: "object",
      properties: {
        findings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: { type: "string" },
              severity: { type: "string" },
              message: { type: "string" },
              relatedNodeIds: { type: "array", items: { type: "string" } },
            },
            required: ["kind", "severity", "message"],
          },
        },
      },
      required: ["findings"],
    },
  },
  {
    name: "resolve_conflict",
    title: "Çelişkiyi çöz",
    description:
      "İki çelişen kaydı çözer: KAZANANI tutar, KAYBEDENİ supersede eder (bayatlatır). keep'in markdown KAYNAĞINA [[supersedes::<supersede>]] eklenir → çelişki çözülür, kaybeden STALE olur. 'Kaynaklar çeliştiğinde Vitrus söyler; sen hangisinin kazandığını söyle.' Yalnız ERİŞEBİLDİĞİN keep düğümünde (fail-closed).",
    inputSchema: {
      type: "object",
      properties: {
        keep: { type: "string", description: "kazanan (tutulan) düğüm slug'ı" },
        supersede: { type: "string", description: "kaybeden (geçersiz kılınan) düğüm slug'ı" },
        reason: { type: "string", description: "çözüm gerekçesi (opsiyonel)" },
      },
      required: ["keep", "supersede"],
    },
    outputSchema: {
      type: "object",
      properties: { keep: { type: "string" }, superseded: { type: "string" }, resolved: { type: "boolean" } },
      required: ["resolved"],
    },
  },
  {
    name: "provenance",
    title: "Kaynak izi",
    description:
      "Bir düğümün kaynağını döndürür (connector, dış uri, yakalanma zamanı) + git-Markdown kaynağa resource_link. 'Bu bilgi nereden geldi?'",
    inputSchema: {
      type: "object",
      properties: { slug: { type: "string", description: "düğüm slug'ı" } },
      required: ["slug"],
    },
    outputSchema: {
      type: "object",
      properties: {
        found: { type: "boolean" },
        slug: { type: "string" },
        connector: { type: ["string", "null"] },
        sourceId: { type: ["string", "null"] },
        uri: { type: ["string", "null"] },
        capturedAt: { type: ["string", "null"] },
      },
      required: ["found"],
    },
  },
  {
    name: "skill_export",
    title: "Skill dışa aktar",
    description:
      "Bir iş akışını çalıştırılabilir Agent Skill'e (SKILL.md) çevirir: canlı Vitrus tool çağrıları + bilinen boşluklar + provenance. Standart geçerliliği kontrol edilir.",
    inputSchema: {
      type: "object",
      properties: { topic: { type: "string", description: "iş akışı konusu" } },
      required: ["topic"],
    },
    outputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        valid: { type: "boolean" },
        errors: { type: "array", items: { type: "string" } },
        skillMd: { type: "string" },
        files: { type: "array", items: { type: "string" } },
      },
      required: ["name", "valid", "skillMd", "files"],
    },
  },
  {
    name: "verify",
    title: "İddia doğrula",
    description:
      "Bir iddiayı şirket beyninin DETERMİNİSTİK kaydına karşı doğrular: grounded (kaynaklı) / contradicted (çelişik) / stale (bayat) / unsupported (desteksiz). 'Asla self-report'a güvenme' — ajan ne derse desin Vitrus yeniden bakar. LLM yok.",
    inputSchema: {
      type: "object",
      properties: { claim: { type: "string", description: "doğrulanacak iddia" } },
      required: ["claim"],
    },
    outputSchema: {
      type: "object",
      properties: {
        status: { type: "string" },
        confidence: { type: "number" },
        support: { type: "array", items: { type: "object" } },
        conflicts: { type: "array", items: { type: "object" } },
      },
      required: ["status", "confidence"],
    },
  },
  {
    name: "remember",
    title: "Hafızaya yaz",
    description:
      "Yeni bilgiyi/kararı şirket beynine YAZAR (ajan kalıcı hafıza biriktirir — GBrain gibi). Markdown KAYNAĞINA yazılır (sahiplik; reindex'te kalır) + indekslenir. Varsayılan ACL = yazan kimlik (private). 'Deneyim → sayfa, karar → searchable memory.'",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "hatırlanacak metin (markdown; [[wikilink]] auto-link)" },
        title: { type: "string", description: "kısa başlık (slug + görünür ad)" },
        type: { type: "string", description: "NodeType (varsayılan note)" },
        acl: { type: "string", description: "izin: 'public' | 'group:eng' | 'user:bob'; boş → yazan kimlik" },
      },
      required: ["content"],
    },
    outputSchema: {
      type: "object",
      properties: { slug: { type: "string" }, persisted: { type: "string" }, acl: { type: "array", items: { type: "object" } } },
      required: ["slug", "persisted"],
    },
  },
  {
    name: "forget",
    title: "Hafızadan sil",
    description:
      "Bir bilgiyi unutur (soft-delete; markdown kaynağından da kaldırır → reindex'te geri gelmez). Yalnız ERİŞEBİLDİĞİN düğümü silebilirsin (fail-closed).",
    inputSchema: { type: "object", properties: { slug: { type: "string", description: "silinecek düğüm slug'ı" } }, required: ["slug"] },
    outputSchema: { type: "object", properties: { slug: { type: "string" }, forgotten: { type: "boolean" } }, required: ["forgotten"] },
  },
  {
    name: "improve",
    title: "Hafızayı iyileştir",
    description:
      "Bir düğüme geri besleme: not ekle ve/veya önemi (salience) ayarla. Yalnız ERİŞEBİLDİĞİN düğümde; markdown kaynağı + indeks güncellenir.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "düğüm slug'ı" },
        appendNote: { type: "string", description: "içeriğe iliştirilecek not" },
        salienceDelta: { type: "number", description: "önem değişimi (−1..1)" },
      },
      required: ["slug"],
    },
    outputSchema: { type: "object", properties: { slug: { type: "string" }, improved: { type: "boolean" } }, required: ["improved"] },
  },
  {
    name: "record_decision",
    title: "Karar kaydet",
    description:
      "Bir KARARI gerekçesi + kaynakları ile şirket beynine yazar (brainincorp/Glen 'karardan sonra yaz' döngüsü — ama Vitrus'ta provenance + çelişki kontrolüyle). Karar 'durable/decisions/' altına markdown KAYNAĞINA yazılır (sahiplik; reindex'te kalır). 'supersedes' verilirse eski karar bayat (stale) işaretlenir; 'contradicts' verilirse çelişki kenarı kurulur. YAZDIKTAN SONRA deterministik gap analizi koşar: bu karar mevcut bilgiyle çelişiyor/bayatlatıyorsa ajana GERİ söyler (glass-box — sessizce üzerine yazmaz).",
    inputSchema: {
      type: "object",
      properties: {
        decision: { type: "string", description: "karar ifadesi (ne kararlaştırıldı)" },
        rationale: { type: "string", description: "gerekçe (neden) — opsiyonel" },
        sources: {
          type: "array",
          items: { type: "string" },
          description: "kaynaklar: iç düğüm slug'ı (→ [[mentions]] alıntı) veya dış URL",
        },
        supersedes: { type: "string", description: "yerini aldığı eski karar slug'ı (→ eski bayat işaretlenir)" },
        contradicts: { type: "string", description: "çeliştiği karar slug'ı (→ açık çelişki kenarı, gap'te raporlanır)" },
        title: { type: "string", description: "kısa başlık (slug + görünür ad); boş → karardan türetilir" },
        acl: { type: "string", description: "izin: 'public' | 'group:eng' | 'user:bob'; boş → yazan kimlik (fail-closed)" },
      },
      required: ["decision"],
    },
    outputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        persisted: { type: "string" },
        acl: { type: "array", items: { type: "object" } },
        conflicts: { type: "array", items: { type: "object" } },
        superseded: { type: "array", items: { type: "string" } },
      },
      required: ["slug", "persisted", "conflicts"],
    },
  },
  {
    name: "capture_session",
    title: "Oturumu yakala",
    description:
      "Ajan muhakeme oturumunu (özet/transcript) şirket beynine KAYDEDER — 'repo hafıza değildir': denenip budanmış dallar, neden-böyle-karar-verildi. 'working/sessions/' altına PRIVATE (sahip) ACL ile yazılır + TTL (varsayılan 30 gün) sonra dream-loop otomatik bayatlatır. Glass-box otomatik yakalama (Stop hook'tan çağrılır).",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "oturum özeti/muhakemesi (markdown; [[wikilink]] auto-link)" },
        title: { type: "string", description: "kısa başlık; boş → özetten türetilir" },
        scope: { type: "string", description: "proje/rol kapsamı (retrieval scope filtresi)" },
        ttlDays: { type: "integer", minimum: 1, description: "TTL gün (varsayılan 30); sonra dream-loop bayatlatır" },
      },
      required: ["summary"],
    },
    outputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        persisted: { type: "string" },
        expiresAt: { type: ["string", "null"] },
      },
      required: ["slug", "persisted"],
    },
  },
  // ── M3.3: mevcut motor yeteneklerini MCP'ye açan ek araçlar ──
  {
    name: "entities",
    title: "Varlık listesi",
    description: "Beyindeki varlıkları (kişi/servis/karar/ekip…) anma sıklığına göre listeler. minMentions ile eşik. LLM'siz.",
    inputSchema: { type: "object", properties: { minMentions: { type: "integer", minimum: 1, default: 1 } } },
    outputSchema: { type: "object", properties: { entities: { type: "array", items: { type: "object" } } }, required: ["entities"] },
  },
  {
    name: "graph_query",
    title: "Tipli graf sorgusu",
    description: "Bir düğümden tipli kenarla bağlı düğümleri getirir (ör. owns → bir servisin sahibi, reports_to → kime rapor verir). Anchor ACL-korumalı.",
    inputSchema: { type: "object", properties: { slug: { type: "string" }, edgeType: { type: "string", description: "works_at|member_of|reports_to|owns|depends_on|… (boş = tümü)" } }, required: ["slug"] },
    outputSchema: { type: "object", properties: { nodes: { type: "array", items: { type: "object" } } }, required: ["nodes"] },
  },
  {
    name: "get_node",
    title: "Düğüm getir",
    description: "Tek düğümü slug ile getirir (içerik + frontmatter + provenance). ACL-korumalı (yetkisiz → bulunamadı).",
    inputSchema: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] },
    outputSchema: { type: "object", properties: { found: { type: "boolean" }, slug: { type: "string" }, content: { type: ["string", "null"] } }, required: ["found"] },
  },
  {
    name: "chunks",
    title: "Düğüm chunk'ları",
    description: "Bir düğümün chunk'larını sırayla getirir (denetlenebilirlik). ACL-korumalı.",
    inputSchema: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] },
    outputSchema: { type: "object", properties: { chunks: { type: "array", items: { type: "object" } } }, required: ["chunks"] },
  },
  {
    name: "supporting_chunks",
    title: "Destekleyen chunk'lar",
    description: "Bir sorguyu en çok destekleyen chunk'ları (skorlu) getirir — 'hangi pasaj cevabı verdi'. ACL-korumalı.",
    inputSchema: { type: "object", properties: { slug: { type: "string" }, query: { type: "string" } }, required: ["slug", "query"] },
    outputSchema: { type: "object", properties: { chunks: { type: "array", items: { type: "object" } } }, required: ["chunks"] },
  },
  {
    name: "graph_snapshot",
    title: "Graf anlık görüntüsü",
    description: "Görselleştirme için düğüm+kenar anlık görüntüsü (bayat/gap işaretli). limit ile kırpılır (sessiz kırpma yok).",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 500, default: 120 } } },
    outputSchema: { type: "object", properties: { nodes: { type: "array" }, edges: { type: "array" }, truncated: { type: "integer" } }, required: ["nodes", "edges"] },
  },
  {
    name: "attention",
    title: "Dikkat bekleyenler",
    description: "Proaktif 'dikkatini bekleyenler': bayat kalıcı bilgi + çözülmemiş incident + yaşlanan boşluk (şiddete göre sıralı). now ISO (boşsa sunucu saati).",
    inputSchema: { type: "object", properties: { now: { type: "string", description: "ISO zaman (boşsa sunucu saati)" } } },
    outputSchema: { type: "object", properties: { items: { type: "array", items: { type: "object" } } }, required: ["items"] },
  },
  {
    name: "conflicts",
    title: "Çelişkiler",
    description: "Kaynaklar çeliştiğinde iki tarafıyla (slug+başlık) + çözüm durumuyla listeler (resolve_conflict ile çöz). Deterministik.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object", properties: { conflicts: { type: "array", items: { type: "object" } } }, required: ["conflicts"] },
  },
  // ── M1 Faz B: Agent-Native API Hub (Gorilla) ──
  {
    name: "api_search",
    title: "API endpoint ara",
    description: "Göreve en uygun API endpoint'ini bul (agent-native API hub; önce 'vitrus api import <spec>').",
    inputSchema: { type: "object", properties: { task: { type: "string" }, limit: { type: "integer", default: 5 } }, required: ["task"] },
    outputSchema: { type: "object", properties: { endpoints: { type: "array", items: { type: "object" } } }, required: ["endpoints"] },
  },
  {
    name: "api_describe",
    title: "API endpoint kartı",
    description: "Bir endpoint'i operationId veya 'METHOD /path' ile aç: parametreler, body, auth.",
    inputSchema: { type: "object", properties: { ref: { type: "string" } }, required: ["ref"] },
    outputSchema: { type: "object", properties: { found: { type: "boolean" }, card: { type: ["object", "null"] } }, required: ["found"] },
  },
  {
    name: "api_verify",
    title: "API çağrısı doğrula (anti-halüsinasyon)",
    description: "Önerilen endpoint+argümanları spec'e karşı DETERMİNİSTİK doğrula (valid/missing_args/wrong_type/unknown_args/unknown_endpoint/deprecated) — ÇAĞIRMADAN ÖNCE.",
    inputSchema: { type: "object", properties: { ref: { type: "string" }, args: { type: "object" } }, required: ["ref"] },
    outputSchema: { type: "object", properties: { status: { type: "string" }, ok: { type: "boolean" }, issues: { type: "array", items: { type: "string" } } }, required: ["status", "ok"] },
  },
  {
    name: "api_call",
    title: "API çağır (doğrula→çalıştır)",
    description: "Doğrula, geçerse çalıştır. verdict.ok=false → çağrı YOK. dryRun ile yalnız doğrula+URL. token = Bearer auth.",
    inputSchema: { type: "object", properties: { ref: { type: "string" }, args: { type: "object" }, token: { type: "string" }, baseUrl: { type: "string" }, dryRun: { type: "boolean", default: false } }, required: ["ref"] },
    outputSchema: { type: "object", properties: { ok: { type: "boolean" }, status: { type: ["integer", "null"] }, verdict: { type: "object" } }, required: ["ok", "verdict"] },
  },
  // ── M2: Onboarding / Day-One ──
  {
    name: "onboarding_path",
    title: "Onboarding yolu",
    description: "Bir rol/alan için beyinden sıralı, kaynaklı öğrenme yolu + kime-sor + belgesiz boşluklar (gap-flywheel). Yeni eleman/ajan onboarding'i.",
    inputSchema: { type: "object", properties: { role: { type: "string" }, limit: { type: "integer", default: 12 } }, required: ["role"] },
    outputSchema: { type: "object", properties: { role: { type: "string" }, steps: { type: "array", items: { type: "object" } }, gaps: { type: "array", items: { type: "object" } } }, required: ["role", "steps"] },
  },
  {
    name: "quiz",
    title: "Bilgi sınavı üret",
    description: "Bir konudan aktif-geri-çağırma soruları üret; cevap 'verify' ile deterministik notlanır (grounded/contradicted/unsupported).",
    inputSchema: { type: "object", properties: { topic: { type: "string" }, count: { type: "integer", default: 5 } }, required: ["topic"] },
    outputSchema: { type: "object", properties: { questions: { type: "array", items: { type: "object" } } }, required: ["questions"] },
  },
  {
    name: "schema_lint",
    title: "Şema denetimi",
    description: "Beyni şema paketine (vitrus-base) karşı deterministik denetle: bilinmeyen node/edge tipi + kenar from→to ihlali. Taksonomi tutarlılığı (M3.7).",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 2000, default: 1000 } } },
    outputSchema: { type: "object", properties: { pack: { type: "string" }, findings: { type: "array", items: { type: "object" } }, scannedNodes: { type: "integer" }, scannedEdges: { type: "integer" }, truncated: { type: "integer" } }, required: ["pack", "findings"] },
  },
  {
    name: "schema_explain_type",
    title: "Tip açıkla",
    description: "Bir node/edge tipini şema paketinden açıkla: anlam + (node için) katıldığı kenarlar / (edge için) izinli from→to. Ajanın doğru tip/kenar seçmesini sağlar (M3.7).",
    inputSchema: { type: "object", properties: { type: { type: "string" } }, required: ["type"] },
    outputSchema: { type: "object", properties: { name: { type: "string" }, kind: { type: "string" }, description: { type: "string" } }, required: ["name", "kind"] },
  },
  {
    name: "briefing",
    title: "Brifing (scheduled-prep)",
    description: "Deterministik 'sabah brifingi' (M3.8): dikkat bekleyenler + boşluk sayıları + açık çelişkiler + düzeltilebilir uncited (kaynak önerisi olan). Ajanın güne hazır başlaması için. now ISO (boşsa sunucu saati).",
    inputSchema: { type: "object", properties: { now: { type: "string", description: "ISO zaman (boşsa sunucu saati)" } } },
    outputSchema: { type: "object", properties: { generatedAt: { type: "string" }, attention: { type: "array", items: { type: "object" } }, gapCounts: { type: "object" }, openConflicts: { type: "integer" }, fixableUncited: { type: "integer" } }, required: ["generatedAt", "attention", "openConflicts", "fixableUncited"] },
  },
];

/** Ajan-yazma için markdown KAYNAĞI (sahiplik): remember/forget/improve burayı günceller. */
export interface MemoryStore {
  writeNode(node: Omit<KnowledgeNode, "id" | "createdAt" | "updatedAt">): { relPath: string; edges: TypedEdge[] };
  removeNode(slug: string): boolean;
}

/** Çağrı bağlamı: doğrulanan principal seti (ACL) + opsiyonel yazma kaynağı (VITRUS_BRAIN). */
export interface ToolContext {
  principals?: string[];
  store?: MemoryStore;
}

export async function callTool(
  engine: BrainEngine,
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext = {}
): Promise<ToolCallResult> {
  const principals = ctx.principals;
  switch (name) {
    case "search": {
      const explain = args.explain === true;
      const hits = await engine.search(String(args.query ?? ""), {
        limit: typeof args.limit === "number" ? args.limit : 10,
        principals,
        audit: !!principals,
      });
      const structured = {
        hits: hits.map((h) => ({
          slug: h.node.slug,
          score: Number(h.score.toFixed(5)),
          vectorRank: h.vectorRank ?? null,
          bm25Rank: h.bm25Rank ?? null,
          cosine: h.boosts?.cosine ?? null,
          ...(explain ? { explanation: explainFactors(h) } : {}),
        })),
      };
      const lines = hits
        .map((h) => `${h.score.toFixed(4)}  ${h.node.slug}` + (explain ? "\n" + explainFactors(h).map((l) => "    " + l).join("\n") : ""))
        .join("\n");
      return {
        structuredContent: structured,
        content: [
          text(lines || "(sonuç yok)"),
          ...hits.map((h) => resourceLink(h.node.slug, h.node.provenance.uri)),
        ],
      };
    }

    case "think": {
      const query = String(args.query ?? "");
      const r = await engine.think(query, { principals });
      const surface = buildSurface(query, r);
      return {
        structuredContent: surface,
        content: [
          text(r.answer),
          ...r.citations.map((c) => resourceLink(c.slug, c.uri)),
        ],
      };
    }

    case "gap_report": {
      const gaps = await engine.findGaps();
      return {
        structuredContent: { gaps },
        content: [text(gaps.map((g) => `[${g.kind}] ${g.message}`).join("\n") || "(boşluk yok)")],
      };
    }

    case "ops_report": {
      const threshold = typeof args.bottleneckThreshold === "number" ? args.bottleneckThreshold : undefined;
      const findings = await engine.findOps(threshold ? { bottleneckThreshold: threshold } : {});
      return {
        structuredContent: { findings },
        content: [text(findings.map((f) => `[${f.severity}] ${f.kind}: ${f.message}`).join("\n") || "(no operational inefficiencies)")],
      };
    }

    case "resolve_conflict": {
      const keep = String(args.keep ?? "").trim();
      const drop = String(args.supersede ?? args.drop ?? "").trim();
      if (!keep || !drop) return { content: [text("resolve_conflict: 'keep' ve 'supersede' gerekli")], isError: true };
      const node = await engine.getNode(keep, principals); // fail-closed: erişemediğin keep → çözme
      if (!node)
        return { structuredContent: { resolved: false }, content: [text(`resolve_conflict: erişilemez veya yok: ${keep}`)], isError: false };
      const reason = args.reason ? ` (${String(args.reason)})` : "";
      const newContent = `${node.content}\n\nThis [[supersedes::${drop}]] — conflict resolved${reason}.`;
      const updated: Omit<KnowledgeNode, "id" | "createdAt" | "updatedAt"> = {
        slug: node.slug,
        type: node.type,
        tier: node.tier,
        title: node.title,
        content: newContent,
        frontmatter: node.frontmatter,
        salience: node.salience,
        provenance: node.provenance,
        acl: node.acl,
        contentHash: contentHash(newContent),
      };
      if (ctx.store) ctx.store.writeNode(updated);
      await engine.putNode(updated);
      await engine.refreshEntities();
      return {
        structuredContent: { keep: node.slug, superseded: slugToId(drop), resolved: true },
        content: [text(`✓ conflict resolved: "${node.slug}" supersedes "${slugToId(drop)}" (now stale)`), resourceLink(node.slug, null)],
        isError: false,
      };
    }

    case "provenance": {
      const slug = String(args.slug ?? "");
      const node = await engine.getNode(slug, principals); // yetkisiz → null (sızdırmaz)
      if (!node) {
        return {
          structuredContent: { found: false, slug },
          content: [text(`bulunamadı: ${slug}`)],
          isError: false,
        };
      }
      const p = node.provenance;
      return {
        structuredContent: {
          found: true,
          slug,
          connector: p.connector,
          sourceId: p.sourceId,
          uri: p.uri,
          capturedAt: p.capturedAt,
        },
        content: [
          text(`${slug} · connector=${p.connector ?? "-"} · uri=${p.uri ?? "-"} · yakalandı=${p.capturedAt ?? "-"}`),
          resourceLink(slug, p.uri),
        ],
      };
    }

    case "skill_export": {
      // Skill yalnız kullanıcının GÖREBİLDİĞİ içerikten türetilir (ACL akar).
      const skill = await engine.exportSkill(String(args.topic ?? ""), { principals });
      const v = validateSkillFile(skill);
      const bundle = skillToBundle(skill);
      const skillMd = skillFileToMarkdown(skill);
      return {
        structuredContent: {
          name: skill.name,
          valid: v.ok,
          errors: v.errors,
          skillMd,
          files: bundle.files.map((f) => f.path),
        },
        content: [text(skillMd)],
        isError: !v.ok,
      };
    }

    case "verify": {
      const claim = String(args.claim ?? "");
      const r = await verifyClaim(engine, claim, { principals });
      return {
        structuredContent: { status: r.status, confidence: r.confidence, support: r.support, conflicts: r.conflicts },
        content: [text(renderVerify(r)), ...r.support.map((s) => resourceLink(s.slug, null))],
        isError: false,
      };
    }

    case "remember": {
      const content = String(args.content ?? "").trim();
      if (!content) return { content: [text("remember: 'content' gerekli")], isError: true };
      const title = (args.title ? String(args.title) : content.split(/\s+/).slice(0, 6).join(" ")).slice(0, 60);
      const owner = principals?.[0];
      const acl: AclEntry[] = args.acl ? parseAcl(String(args.acl)) : owner ? [{ kind: "user", principal: owner }] : [];
      const slug = `working/agent/${slugifyName(title)}`;
      const node: Omit<KnowledgeNode, "id" | "createdAt" | "updatedAt"> = {
        slug,
        type: (args.type ? String(args.type) : "note") as NodeType,
        tier: "working",
        title,
        content,
        frontmatter: {},
        salience: 0.5,
        provenance: { connector: "agent", sourceId: slug, uri: null, capturedAt: null },
        acl,
        contentHash: contentHash(content),
      };
      let persisted = "index-only";
      if (ctx.store) {
        ctx.store.writeNode(node); // sahiplik: markdown kaynağına yaz → reindex'te kalır
        persisted = "markdown+index";
      }
      await engine.putNode(node);
      await engine.refreshEntities();
      await engine.refreshSalience();
      return {
        structuredContent: { slug, persisted, acl },
        content: [
          text(
            `✓ remembered: ${slug} (${persisted})` +
              (persisted === "index-only" ? " — ⚠ VITRUS_BRAIN ver: markdown kaynağına yazılsın (reindex'te kalsın)" : "")
          ),
          resourceLink(slug, null),
        ],
        isError: false,
      };
    }

    case "forget": {
      const slug = String(args.slug ?? "");
      const node = await engine.getNode(slug, principals); // ACL: yetkisiz/yok → null (fail-closed)
      if (!node)
        return { structuredContent: { slug, forgotten: false }, content: [text(`forget: erişilemez veya yok: ${slug}`)], isError: false };
      await engine.deleteNode(slug);
      if (ctx.store) ctx.store.removeNode(slug); // reindex'te geri gelmesin
      return { structuredContent: { slug, forgotten: true }, content: [text(`✓ forgotten: ${slug}`)], isError: false };
    }

    case "improve": {
      const slug = String(args.slug ?? "");
      const node = await engine.getNode(slug, principals);
      if (!node)
        return { structuredContent: { slug, improved: false }, content: [text(`improve: erişilemez veya yok: ${slug}`)], isError: false };
      const newContent = args.appendNote ? `${node.content}\n\n${String(args.appendNote)}` : node.content;
      const delta = typeof args.salienceDelta === "number" ? args.salienceDelta : 0;
      const updated: Omit<KnowledgeNode, "id" | "createdAt" | "updatedAt"> = {
        slug: node.slug,
        type: node.type,
        tier: node.tier,
        title: node.title,
        content: newContent,
        frontmatter: node.frontmatter,
        salience: Math.max(0, Math.min(1, node.salience + delta)),
        provenance: node.provenance,
        acl: node.acl,
        contentHash: contentHash(newContent),
      };
      if (ctx.store) ctx.store.writeNode(updated);
      await engine.putNode(updated);
      return { structuredContent: { slug, improved: true }, content: [text(`✓ improved: ${slug}`)], isError: false };
    }

    case "record_decision": {
      const decision = String(args.decision ?? "").trim();
      if (!decision) return { content: [text("record_decision: 'decision' gerekli")], isError: true };
      const rationale = args.rationale ? String(args.rationale).trim() : "";
      const sources = Array.isArray(args.sources)
        ? (args.sources as unknown[]).map((s) => String(s).trim()).filter(Boolean)
        : [];
      const supersedes = args.supersedes ? slugToId(String(args.supersedes)) : "";
      const contradicts = args.contradicts ? slugToId(String(args.contradicts)) : "";
      const title = (args.title ? String(args.title) : decision.split(/\s+/).slice(0, 8).join(" ")).slice(0, 80);
      const owner = principals?.[0];
      const acl: AclEntry[] = args.acl ? parseAcl(String(args.acl)) : owner ? [{ kind: "user", principal: owner }] : [];

      // Gövde: karar + gerekçe + kaynaklar (iç slug → [[mentions]] alıntı; dış → link) + supersedes/contradicts.
      // Wikilink'ler putNode'da otomatik tipli kenara dönüşür (LLM'siz) → gap analizi besler.
      const isUrl = (s: string) => /^https?:\/\//i.test(s);
      const lines: string[] = [`# ${title}`, "", decision];
      if (rationale) lines.push("", "## Rationale", rationale);
      if (sources.length) {
        lines.push("", "## Sources");
        for (const s of sources) lines.push(isUrl(s) ? `- ${s}` : `- [[mentions::${slugToId(s)}]]`);
      }
      if (supersedes) lines.push("", `Supersedes [[supersedes::${supersedes}]].`);
      if (contradicts) lines.push("", `This [[contradicts::${contradicts}]] — conflict open.`);
      const content = lines.join("\n");

      const slug = `durable/decisions/${slugifyName(title)}`;
      const node: Omit<KnowledgeNode, "id" | "createdAt" | "updatedAt"> = {
        slug,
        type: "decision",
        tier: "durable",
        title,
        content,
        frontmatter: {},
        salience: 0.7, // kararlar önemli (working note'tan yüksek)
        provenance: { connector: "agent", sourceId: slug, uri: null, capturedAt: new Date().toISOString() },
        acl,
        contentHash: contentHash(content),
      };
      let persisted = "index-only";
      if (ctx.store) {
        ctx.store.writeNode(node); // sahiplik: markdown kaynağına yaz → reindex'te kalır
        persisted = "markdown+index";
      }
      await engine.putNode(node);
      await engine.refreshEntities();
      await engine.refreshSalience();

      // Glass-box: yazdıktan SONRA deterministik gap analizi — bu karar neyle çelişiyor / neyi bayatlattı?
      const saved = await engine.getNode(slug, principals);
      const gaps = saved ? await engine.findGaps() : [];
      const mine = saved ? gaps.filter((g) => g.relatedNodeIds.includes(saved.id)) : [];
      const conflicts = mine
        .filter((g) => g.kind === "contradiction")
        .map((g) => ({ kind: g.kind, message: g.message }));
      const superseded = supersedes ? [supersedes] : [];

      const banner = conflicts.length
        ? `\n⚠ ${conflicts.length} contradiction(s): ` + conflicts.map((c) => c.message).join(" | ")
        : "";
      return {
        structuredContent: { slug, persisted, acl, conflicts, superseded },
        content: [
          text(
            `✓ decision recorded: ${slug} (${persisted})` +
              (supersedes ? ` · supersedes ${supersedes} (now stale)` : "") +
              (persisted === "index-only" ? " — ⚠ set VITRUS_BRAIN to persist to markdown source" : "") +
              banner
          ),
          resourceLink(slug, null),
        ],
        isError: false,
      };
    }

    case "capture_session": {
      const summary = String(args.summary ?? "").trim();
      if (!summary) return { content: [text("capture_session: 'summary' gerekli")], isError: true };
      const title = (args.title ? String(args.title) : summary.split(/\s+/).slice(0, 8).join(" ")).slice(0, 60);
      const owner = principals?.[0];
      const acl: AclEntry[] = owner ? [{ kind: "user", principal: owner }] : []; // PRIVATE (fail-closed)
      const ttlDays = typeof args.ttlDays === "number" && args.ttlDays > 0 ? Math.floor(args.ttlDays) : 30;
      const capturedAt = new Date().toISOString();
      const expiresAt = new Date(Date.parse(capturedAt) + ttlDays * 86_400_000).toISOString();
      const slug = `working/sessions/${slugifyName(title)}`;
      const node: Omit<KnowledgeNode, "id" | "createdAt" | "updatedAt"> = {
        slug,
        type: "session",
        tier: "working",
        title,
        content: summary,
        frontmatter: {},
        salience: 0.4, // oturumlar düşük başlangıç önemi → TTL ile bayatlar
        provenance: { connector: "agent", sourceId: slug, uri: null, capturedAt },
        acl,
        contentHash: contentHash(summary),
        scope: args.scope ? String(args.scope) : undefined,
        expiresAt,
      };
      let persisted = "index-only";
      if (ctx.store) {
        ctx.store.writeNode(node);
        persisted = "markdown+index";
      }
      await engine.putNode(node);
      return {
        structuredContent: { slug, persisted, expiresAt },
        content: [
          text(`✓ session captured: ${slug} (${persisted}) · expires ${expiresAt.slice(0, 10)}`),
          resourceLink(slug, null),
        ],
        isError: false,
      };
    }

    case "entities": {
      const min = typeof args.minMentions === "number" ? args.minMentions : 1;
      const entities = await engine.listEntities(min);
      return {
        structuredContent: { entities },
        content: [text(entities.map((e) => `${e.name} (${e.entityType}) ×${e.mentionCount}`).join("\n") || "(varlık yok)")],
      };
    }

    case "graph_query": {
      const slug = String(args.slug ?? "");
      const anchor = await engine.getNode(slug, principals); // fail-closed: anchor'ı göremiyorsan boş dön
      if (!anchor) return { structuredContent: { nodes: [] }, content: [text(`erişilemez veya yok: ${slug}`)] };
      const edgeType = args.edgeType ? (String(args.edgeType) as EdgeType) : undefined;
      const nodes = await engine.graphQuery(slug, edgeType);
      const view = nodes.map((n) => ({ slug: n.slug, title: n.title, type: n.type }));
      return {
        structuredContent: { nodes: view },
        content: [
          text(view.map((n) => `${n.slug} (${n.type})`).join("\n") || "(bağlı düğüm yok)"),
          ...view.map((n) => resourceLink(n.slug, null)),
        ],
      };
    }

    case "get_node": {
      const slug = String(args.slug ?? "");
      const node = await engine.getNode(slug, principals); // ACL: yetkisiz → bulunamadı (sızdırmaz)
      if (!node) return { structuredContent: { found: false, slug, content: null }, content: [text(`bulunamadı: ${slug}`)] };
      return {
        structuredContent: {
          found: true,
          slug,
          type: node.type,
          tier: node.tier,
          title: node.title,
          content: node.content,
          frontmatter: node.frontmatter,
          provenance: node.provenance,
        },
        content: [text(`# ${node.title}\n${node.content}`), resourceLink(slug, node.provenance.uri)],
      };
    }

    case "chunks": {
      const slug = String(args.slug ?? "");
      const node = await engine.getNode(slug, principals); // ACL gate
      if (!node) return { structuredContent: { chunks: [] }, content: [text(`erişilemez veya yok: ${slug}`)] };
      const chunks = await engine.getChunks(slug);
      return {
        structuredContent: { chunks },
        content: [
          text(chunks.map((c) => `[${c.idx}] ${c.content.slice(0, 200)}`).join("\n\n") || "(chunk yok)"),
          resourceLink(slug, node.provenance.uri),
        ],
      };
    }

    case "supporting_chunks": {
      const slug = String(args.slug ?? "");
      const query = String(args.query ?? "");
      const node = await engine.getNode(slug, principals); // ACL gate
      if (!node) return { structuredContent: { chunks: [] }, content: [text(`erişilemez veya yok: ${slug}`)] };
      const chunks = await engine.supportingChunks(slug, query);
      return {
        structuredContent: { chunks },
        content: [
          text(chunks.map((c) => `[${c.idx}] (${c.score.toFixed(3)}) ${c.content.slice(0, 200)}`).join("\n\n") || "(eşleşen chunk yok)"),
          resourceLink(slug, node.provenance.uri),
        ],
      };
    }

    case "graph_snapshot": {
      const limit = typeof args.limit === "number" ? args.limit : 120;
      const snap = await engine.graphSnapshot({ limit });
      return {
        structuredContent: snap,
        content: [text(`${snap.nodes.length} düğüm · ${snap.edges.length} kenar${snap.truncated ? ` · +${snap.truncated} çizilmedi (limit)` : ""}`)],
      };
    }

    case "attention": {
      const now = String(args.now ?? new Date().toISOString());
      const items = await engine.attention(now);
      return {
        structuredContent: { items },
        content: [text(items.map((i) => `[${i.severity}] ${i.kind}: ${i.message}`).join("\n") || "(dikkat bekleyen yok)")],
      };
    }

    case "conflicts": {
      const conflicts = await engine.findConflicts();
      return {
        structuredContent: { conflicts },
        content: [
          text(conflicts.map((c) => `${c.resolved ? "✓" : "⚠"} "${c.a.slug}" ⇄ "${c.b.slug}" (${c.kind})`).join("\n") || "(çelişki yok)"),
        ],
      };
    }

    case "api_search": {
      const { apiSearch } = await import("../api-hub/retrieve.js");
      const hits = await apiSearch(engine, String(args.task ?? ""), { limit: typeof args.limit === "number" ? args.limit : 5, principals });
      const endpoints = hits.map((h) => ({ operationId: h.card.operationId, method: h.card.method, path: h.card.path, summary: h.card.summary, score: Number(h.score.toFixed(5)), slug: h.slug }));
      return {
        structuredContent: { endpoints },
        content: [text(endpoints.map((e) => `${e.method} ${e.path} (${e.operationId}) — ${e.summary}`).join("\n") || "(no API endpoints)"), ...hits.map((h) => resourceLink(h.slug, null))],
      };
    }

    case "api_describe": {
      const { findEndpoint } = await import("../api-hub/retrieve.js");
      const { cardToContent } = await import("../api-hub/normalize.js");
      const card = await findEndpoint(engine, String(args.ref ?? ""), principals);
      if (!card) return { structuredContent: { found: false, card: null }, content: [text(`not found: ${String(args.ref ?? "")}`)] };
      return { structuredContent: { found: true, card }, content: [text(cardToContent(card))] };
    }

    case "api_verify": {
      const { findEndpoint } = await import("../api-hub/retrieve.js");
      const { verifyApiCall, renderVerdict } = await import("../api-hub/verify-call.js");
      const card = await findEndpoint(engine, String(args.ref ?? ""), principals);
      const v = verifyApiCall(card, (args.args as Record<string, unknown>) ?? {});
      return { structuredContent: { status: v.status, ok: v.ok, issues: v.issues, endpoint: v.endpoint ?? null }, content: [text(renderVerdict(v, String(args.ref ?? "")))], isError: !v.ok };
    }

    case "api_call": {
      const { findEndpoint } = await import("../api-hub/retrieve.js");
      const { verifyApiCall, renderVerdict } = await import("../api-hub/verify-call.js");
      const { callApi } = await import("../api-hub/execute.js");
      const ref = String(args.ref ?? "");
      const callArgs = (args.args as Record<string, unknown>) ?? {};
      const card = await findEndpoint(engine, ref, principals);
      if (!card) {
        const v = verifyApiCall(undefined, callArgs);
        return { structuredContent: { ok: false, status: null, verdict: v }, content: [text(renderVerdict(v, ref))], isError: true };
      }
      const r = await callApi(card, callArgs, { token: args.token ? String(args.token) : undefined, baseUrl: args.baseUrl ? String(args.baseUrl) : undefined, dryRun: args.dryRun === true });
      return {
        structuredContent: { ok: r.ok, status: r.status ?? null, verdict: r.verdict, url: r.url ?? null, body: r.body ?? null },
        content: [text(renderVerdict(r.verdict, ref) + (r.ok && args.dryRun !== true ? `\n→ HTTP ${r.status}` : ""))],
        isError: !r.ok,
      };
    }

    case "onboarding_path": {
      const { buildCurriculum, renderCurriculum } = await import("../onboard/curriculum.js");
      const c = await buildCurriculum(engine, String(args.role ?? ""), { limit: typeof args.limit === "number" ? args.limit : 12, principals });
      return { structuredContent: c, content: [text(renderCurriculum(c)), ...c.steps.map((s) => resourceLink(s.slug, s.uri))] };
    }

    case "quiz": {
      const { generateQuiz } = await import("../onboard/quiz.js");
      const questions = await generateQuiz(engine, String(args.topic ?? ""), { count: typeof args.count === "number" ? args.count : 5, principals });
      return { structuredContent: { questions }, content: [text(questions.map((q, i) => `${i + 1}. ${q.question}`).join("\n") || "(no questions)")] };
    }

    case "schema_lint": {
      const { schemaLint, VITRUS_BASE_PACK } = await import("../schema/index.js");
      const r = await schemaLint(engine, VITRUS_BASE_PACK, { limit: typeof args.limit === "number" ? args.limit : 1000 });
      const summary =
        r.findings.length === 0
          ? `✓ Şema temiz (${r.scannedNodes} düğüm, ${r.scannedEdges} kenar — ${r.pack}).`
          : `⚠ ${r.findings.length} şema bulgusu (${r.pack}):\n` +
            r.findings.slice(0, 30).map((f) => `  - [${f.kind}] ${f.message}`).join("\n") +
            (r.truncated ? `\n  (${r.truncated} düğüm limit nedeniyle taranmadı)` : "");
      return { structuredContent: r, content: [text(summary)] };
    }

    case "schema_explain_type": {
      const { explainType, VITRUS_BASE_PACK } = await import("../schema/index.js");
      const ex = explainType(VITRUS_BASE_PACK, String(args.type ?? ""));
      if (!ex) return { structuredContent: { error: "unknown_type" }, content: [text(`Bilinmeyen tip: '${args.type}' (${VITRUS_BASE_PACK.name})`)], isError: true };
      const lines = [`${ex.kind === "node" ? "◆" : "↔"} ${ex.name} (${ex.kind}) — ${ex.description}`];
      if (ex.kind === "node") {
        if (ex.slugPattern || ex.tierHint) lines.push(`  ${ex.slugPattern ?? ""}${ex.tierHint ? `  ·  tier: ${ex.tierHint}` : ""}`.trim());
        if (ex.edgesAsFrom?.length) lines.push("  kaynak olarak: " + ex.edgesAsFrom.map((e) => `${e.type}→${e.to.join("/")}`).join(", "));
        if (ex.edgesAsTo?.length) lines.push("  hedef olarak: " + ex.edgesAsTo.map((e) => `${e.from.join("/")}→${e.type}`).join(", "));
      } else {
        lines.push(`  ${ex.from?.join("/")} → ${ex.to?.join("/")}`);
        if (ex.inferredVerbs?.length) lines.push("  fiil ipuçları: " + ex.inferredVerbs.join(", "));
      }
      return { structuredContent: ex, content: [text(lines.join("\n"))] };
    }

    case "briefing": {
      const { buildBriefing, renderBriefing } = await import("../maintenance/dream-analysis.js");
      const now = String(args.now ?? new Date().toISOString());
      const b = await buildBriefing(engine, now);
      return { structuredContent: b, content: [text(renderBriefing(b))] };
    }

    default:
      return { content: [text(`bilinmeyen tool: ${name}`)], isError: true };
  }
}
