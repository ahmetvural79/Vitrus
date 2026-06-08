// src/core/config.ts
// "Ne çalıştırıyorum?" raporu (üretim olgunluğu). Ortamdan çözülen backend + sağlayıcıları
// SIR SIZDIRMADAN özetler (yalnız sağlayıcı adı + anahtar VAR/YOK). doctor/config komutları
// kullanır. Fabrika mantığını (embedderFromEnv/synthesizerFromEnv/rerankerFromEnv) yansıtır.

import { normalizeEnv } from "./env.js";

type Env = Record<string, string | undefined>;

export interface ResolvedConfig {
  backend: "pglite" | "postgres";
  embedder: string;
  synthesizer: string;
  reranker: string;
}

const keyFlag = (v: string | undefined): string => (v ? " (key set)" : " (NO KEY → offline/extractive)");

export function resolveConfig(rawEnv: Env = process.env): ResolvedConfig {
  const env = normalizeEnv(rawEnv);
  const backend = env.VITRUS_PG_URL ?? env.DATABASE_URL ? "postgres" : "pglite";

  const ep = (env.VITRUS_EMBED_PROVIDER ?? "").toLowerCase();
  let embedder: string;
  if (ep === "hashing") embedder = "hashing (offline, deterministic)";
  else if (ep === "gemini") embedder = "gemini" + keyFlag(env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY);
  else if (ep === "cohere") embedder = "cohere" + keyFlag(env.COHERE_API_KEY);
  else if (ep === "openai") embedder = "openai" + keyFlag(env.OPENAI_API_KEY);
  else embedder = env.OPENAI_API_KEY ? "openai (default, key set)" : "hashing (offline, no OPENAI_API_KEY)";

  const sp = (env.VITRUS_SYNTH_PROVIDER ?? "").toLowerCase();
  let synthesizer: string;
  if (env.VITRUS_LLM_SYNTH === "0") synthesizer = "extractive (forced offline)";
  else if (sp === "extractive") synthesizer = "extractive (offline)";
  else if (sp === "anthropic") synthesizer = "anthropic" + keyFlag(env.ANTHROPIC_API_KEY);
  else if (sp === "gemini") synthesizer = "gemini" + keyFlag(env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY);
  else if (sp === "ollama") synthesizer = "ollama (local, no key)";
  else if (sp === "openai") synthesizer = "openai" + keyFlag(env.OPENAI_API_KEY);
  else synthesizer = env.OPENAI_API_KEY ? "openai (default, key set)" : "extractive (offline, no OPENAI_API_KEY)";
  if (env.VITRUS_SYNTH_ROUTE === "1" && !synthesizer.startsWith("extractive")) synthesizer += " + routing";

  const rp = (env.VITRUS_RERANK_PROVIDER ?? "").toLowerCase();
  let reranker: string;
  if (!rp) reranker = "off";
  else if (rp === "lexical") reranker = "lexical (offline)";
  else if (rp === "cohere") reranker = "cohere" + keyFlag(env.COHERE_API_KEY);
  else if (rp === "voyage") reranker = "voyage" + keyFlag(env.VOYAGE_API_KEY);
  else if (rp === "zeroentropy") reranker = "zeroentropy" + keyFlag(env.ZEROENTROPY_API_KEY);
  else reranker = `${rp} (?)`;

  return { backend, embedder, synthesizer, reranker };
}

export function renderConfig(c: ResolvedConfig): string {
  return [
    `backend:     ${c.backend}`,
    `embedder:    ${c.embedder}`,
    `synthesizer: ${c.synthesizer}`,
    `reranker:    ${c.reranker}`,
  ].join("\n");
}
