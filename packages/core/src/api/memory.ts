// src/api/memory.ts
// Dört-fiil bellek API'si (Cognee deseni) — sahiplik-dostu zihinsel model:
//   Remember (yakala) · Recall (sorgula) · Forget (sil) · Improve (geri besle)
// Motor üstünde ince, ekip dashboard'unun ve ajanların tükettiği sözleşme.

import type { BrainEngine } from "../core/engine.js";
import type { KnowledgeNode, SearchOpts, ThinkResult } from "../core/types.js";
import { contentHash } from "../sync/markdown.js";

type NewNode = Omit<KnowledgeNode, "id" | "createdAt" | "updatedAt">;

export interface ImproveFeedback {
  salienceDelta?: number; // geri besleme: önemi artır/azalt
  appendNote?: string; // bilgi ekle (içeriğe iliştir, yeniden türetilir)
}

export class MemoryApi {
  constructor(private readonly engine: BrainEngine) {}

  /** Remember — yeni/ güncel bilgiyi yakala (embed + auto-link + entity/salience tazele). */
  async remember(node: NewNode): Promise<KnowledgeNode> {
    const saved = await this.engine.putNode(node);
    await this.engine.refreshEntities();
    await this.engine.refreshSalience();
    return saved;
  }

  /** Recall — kaynaklı cevap + boşluk + güven (görünürlük yüzeyi). ACL principals'a saygılı. */
  recall(query: string, opts?: SearchOpts): Promise<ThinkResult> {
    return this.engine.think(query, opts);
  }

  /** Forget — bilgiyi unut (soft-delete; git'te markdown silinince de yansır). */
  forget(slug: string): Promise<void> {
    return this.engine.deleteNode(slug);
  }

  /** Improve — geri beslemeyle iyileştir: önemi ayarla ve/veya not ekleyip yeniden türet. */
  async improve(slug: string, fb: ImproveFeedback): Promise<KnowledgeNode> {
    const node = await this.engine.getNode(slug);
    if (!node) throw new Error(`bulunamadı: ${slug}`);
    const content = fb.appendNote ? `${node.content}\n\n${fb.appendNote}` : node.content;
    const salience = Math.max(0, Math.min(1, node.salience + (fb.salienceDelta ?? 0)));
    const updated: NewNode = {
      slug: node.slug,
      type: node.type,
      tier: node.tier,
      title: node.title,
      content,
      frontmatter: node.frontmatter,
      salience,
      provenance: node.provenance,
      acl: node.acl,
      contentHash: contentHash(content),
    };
    // refreshSalience çağrılmaz: manuel geri besleme (salience) anlık korunur;
    // rüya döngüsü (T28) periyodik olarak frekans×tazelik ile yeniden hesaplar.
    return this.engine.putNode(updated);
  }
}
