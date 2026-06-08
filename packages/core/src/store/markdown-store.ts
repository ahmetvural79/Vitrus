// src/store/markdown-store.ts
// KAYNAK-ÜSTÜ depo (Katman 1): müşterinin git deposundaki düz Markdown +
// tipli-kenar sidecar'ları. Doğruluğun yeri burasıdır.
//
// Türev indeks (DB/embedding) BURADAN yeniden kurulabilir; asla tersi değil.
// "İndeks atılabilir" invariantı: depo → indeks tek yön.
//
// Sidecar: her `foo.md` yanına `foo.edges.json` yazılır (graf git'te,
// diff-dostu, LLM'siz). Böylece öz-bağlanan graf da sahip-olunabilir.

import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  statSync,
  rmSync,
} from "node:fs";
import { join, relative, dirname } from "node:path";
import type { KnowledgeNode, TypedEdge } from "../core/types.js";
import { fileToNode, nodeToMarkdown } from "../sync/markdown.js";
import { extractEdges, slugToId } from "../sync/wikilinks.js";

const SIDECAR_VERSION = 1;

export interface NodeWithEdges {
  /** id/createdAt/updatedAt motor tarafından atanır; slug'dan id türetilebilir. */
  node: Omit<KnowledgeNode, "id" | "createdAt" | "updatedAt">;
  id: string;
  edges: TypedEdge[];
  /** Depoya göreli yol (".md" dahil), ör. "durable/people/alice.md". */
  relPath: string;
}

interface SidecarFile {
  version: number;
  edges: TypedEdge[];
}

export class MarkdownStore {
  constructor(private readonly root: string) {}

  /** Depodaki tüm .md dosyalarının göreli yollarını döndürür (özyinelemeli). */
  listFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name.startsWith(".")) continue; // gizli dizin/dosya atla
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name.endsWith(".md")) out.push(relative(this.root, full));
      }
    };
    if (existsSync(this.root)) walk(this.root);
    return out.sort();
  }

  /** Tek bir .md'yi düğüme + tipli kenarlara ayrıştırır (LLM'siz). */
  readNode(relPath: string): NodeWithEdges {
    const raw = readFileSync(join(this.root, relPath), "utf8");
    const node = fileToNode(relPath, raw);
    const id = slugToId(node.slug);
    const edges = extractEdges(id, node.content);
    return { node, id, edges, relPath };
  }

  /** Tüm depoyu okur. */
  readAll(): NodeWithEdges[] {
    return this.listFiles().map((rel) => this.readNode(rel));
  }

  /** `foo.md` → `foo.edges.json` sidecar yolu. */
  sidecarPath(relPath: string): string {
    return relPath.replace(/\.md$/, ".edges.json");
  }

  /** Tipli kenarları sidecar olarak diske yazar (graf git'te kalıcı). */
  writeSidecar(relPath: string, edges: TypedEdge[]): void {
    const payload: SidecarFile = { version: SIDECAR_VERSION, edges };
    const target = join(this.root, this.sidecarPath(relPath));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(payload, null, 2) + "\n", "utf8");
  }

  /** Sidecar'ı okur; yoksa null. */
  readSidecar(relPath: string): TypedEdge[] | null {
    const target = join(this.root, this.sidecarPath(relPath));
    if (!existsSync(target)) return null;
    const parsed = JSON.parse(readFileSync(target, "utf8")) as SidecarFile;
    return parsed.edges ?? [];
  }

  /**
   * Tüm depoyu gezer, her düğümün kenarlarını sidecar'a yazar.
   * Döndürür: { yazılan dosya sayısı, toplam kenar }.
   */
  rebuildSidecars(): { files: number; edges: number } {
    let edgeCount = 0;
    const files = this.listFiles();
    for (const rel of files) {
      const { edges } = this.readNode(rel);
      this.writeSidecar(rel, edges);
      edgeCount += edges.length;
    }
    return { files: files.length, edges: edgeCount };
  }

  /**
   * Bir düğümü .md KAYNAĞINA yazar (frontmatter + gövde) + tipli-kenar sidecar.
   * Ajan `remember` ettiğinde hafıza burada kalıcılaşır → reindex'te korunur
   * (sahiplik invariantı: depo → indeks tek yön).
   */
  writeNode(node: Omit<KnowledgeNode, "id" | "createdAt" | "updatedAt">): { relPath: string; edges: TypedEdge[] } {
    const relPath = `${node.slug}.md`;
    const target = join(this.root, relPath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, nodeToMarkdown(node), "utf8");
    const edges = extractEdges(slugToId(node.slug), node.content);
    this.writeSidecar(relPath, edges);
    return { relPath, edges };
  }

  /** Bir düğümün .md + sidecar dosyasını siler (ajan `forget` — reindex'te geri gelmesin). */
  removeNode(slug: string): boolean {
    const relPath = `${slug}.md`;
    const md = join(this.root, relPath);
    const side = join(this.root, this.sidecarPath(relPath));
    let removed = false;
    if (existsSync(md)) {
      rmSync(md);
      removed = true;
    }
    if (existsSync(side)) rmSync(side);
    return removed;
  }
}
