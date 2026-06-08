// src/core/providers.ts — ortam-güdümlü sağlayıcı fabrikalarının TEK içe-aktarma noktası.
// CLI/MCP içeride doğrudan modüllerden alır; dış tüketiciler (apps/cloud-api) buradan alır:
//   import { embedderFromEnv, synthesizerFromEnv, rerankerFromEnv } from "@vitrus/core/providers";
// Anahtar yoksa hepsi offline/deterministik default'a düşer (resolveConfig ile aynı mantık).

export { embedderFromEnv } from "./openai-embedder.js";
export { synthesizerFromEnv } from "./llm-synthesizer.js";
export { rerankerFromEnv } from "./reranker.js";
export { resolveConfig, renderConfig, type ResolvedConfig } from "./config.js";
