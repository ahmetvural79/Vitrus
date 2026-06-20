// src/schema/types.ts
// M3.7 — Schema packs v1. Hardcoded NodeType/EdgeType union'ı YÜKLENEBİLİR + AÇIKLANABİLİR +
// LINT'lenebilir bir "şema paketi"ne çevirir. Pack, tipleri (insan-okunur açıklama + kenar from/to
// kısıtlarıyla) tanımlar; M1 `api_endpoint` + M2 rol tipleri bunun üstüne temiz oturur.
//
// v1 kapsamı: base pack (vitrus-base) + validatePack + schemaLint + explainType + MCP araçları.
// (v2: YAML/custom pack yükleme, tip çıkarımı, edge-confidence öğrenme.)

/** Bir düğüm tipinin şema tanımı (NodeType değeri + anlam). */
export interface SchemaNodeType {
  /** NodeType değeri, ör. "person". */
  name: string;
  /** Ne / ne zaman kullanılır (insan + ajan okunur). */
  description: string;
  /** Tipik kademe (working/derived/durable) — belgesel ipucu. */
  tierHint?: string;
  /** Tipik slug deseni, ör. "durable/people/<ad>". */
  slugPattern?: string;
}

/** Bir kenar tipinin şema tanımı (EdgeType + yönlü from→to kısıtı). "*" = herhangi node tipi. */
export interface SchemaEdgeType {
  /** EdgeType değeri, ör. "works_at". */
  name: string;
  /** İzinli kaynak düğüm tipleri (["*"] = herhangi). */
  from: string[];
  /** İzinli hedef düğüm tipleri (["*"] = herhangi). */
  to: string[];
  /** Anlam (from → to). */
  description: string;
  /** Çıkarım fiil ipuçları (TR/EN) — belgesel, wikilink tip-çıkarımını besler. */
  inferredVerbs?: string[];
}

/** Yüklenebilir şema paketi. */
export interface SchemaPack {
  /** Pack kimliği, ör. "vitrus-base". */
  name: string;
  /** SemVer, ör. "1.0.0". */
  version: string;
  description?: string;
  nodeTypes: SchemaNodeType[];
  edgeTypes: SchemaEdgeType[];
}

/** schemaLint bulgusu — deterministik (gap deseni gibi; uydurma yok). */
export interface SchemaLintFinding {
  kind: "unknown_node_type" | "unknown_edge_type" | "edge_from_violation" | "edge_to_violation";
  message: string;
  /** İlgili düğüm slug'ı (varsa). */
  slug?: string;
  /** İlgili kenar (varsa). */
  edge?: { from: string; to: string; type: string };
}

export interface SchemaLintReport {
  pack: string;
  findings: SchemaLintFinding[];
  scannedNodes: number;
  scannedEdges: number;
  /** Limit nedeniyle taranamayan düğüm (sessiz kırpma YOK). */
  truncated: number;
}

/** explainType çıktısı — bir tipi (node/edge) açıklar. */
export interface TypeExplanation {
  name: string;
  kind: "node" | "edge";
  description: string;
  // node için: bu tipin katıldığı kenarlar
  tierHint?: string;
  slugPattern?: string;
  edgesAsFrom?: { type: string; to: string[] }[];
  edgesAsTo?: { type: string; from: string[] }[];
  // edge için:
  from?: string[];
  to?: string[];
  inferredVerbs?: string[];
}
