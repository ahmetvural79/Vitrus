// src/mcp/tools.ts
// MCP tool yüzeyi (Katman 3). Transport'tan bağımsız — test edilebilir.
// Her tool: JSON Schema inputSchema + outputSchema (yapısal sonuç) + sonuçta
// resource_link (git-Markdown kaynağa: vitrus://node/<slug> + dış uri).

import type { BrainEngine } from "../core/engine.js";
import type { KnowledgeNode, TypedEdge, AclEntry, NodeType } from "../core/types.js";
import { buildSurface } from "../surface/surface.js";
import { skillFileToMarkdown } from "../skill/skill-file.js";
import { skillToBundle, slugifyName } from "../skill/skill-export.js";
import { validateSkillFile } from "../skill/skill-file.js";
import { verifyClaim, renderVerify } from "../verify/verify.js";
import { parseAcl, contentHash } from "../sync/markdown.js";

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
        })),
      };
      const lines = hits.map((h) => `${h.score.toFixed(4)}  ${h.node.slug}`).join("\n");
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

    default:
      return { content: [text(`bilinmeyen tool: ${name}`)], isError: true };
  }
}
