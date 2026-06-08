// src/core/routing-synthesizer.ts
// D2 — model routing (AI Harness Wars #10): KOLAY sorgular için ucuz yol (deterministik
// ExtractiveSynthesizer — sıfır token), ZOR sorgular için güçlü yol (LLMSynthesizer).
// Deterministik çekirdek zaten LLM'i minimize eder; bu, token'ı YALNIZ gerekince harcar
// ("tokenmax akıllıca"). Zorluk sinyali deterministik + glass-box (LLM yok).

import type { SearchHit } from "./types.js";
import type { Synthesizer, Synthesis, SynthesizeOpts } from "./synthesizer.js";

export type Difficulty = "easy" | "hard";

/** Az kaynak + güçlü benzerlik → kolay; çok kaynak / zayıf benzerlik / kaynaksız → zor. */
export function difficulty(hits: SearchHit[], opts: { cosineFloor?: number; maxEasyHits?: number } = {}): Difficulty {
  const cosineFloor = opts.cosineFloor ?? 0.5;
  const maxEasyHits = opts.maxEasyHits ?? 2;
  const usable = hits.filter((h) => h.node.content.trim().length > 0);
  const top = usable[0]?.boosts?.cosine ?? 0;
  return usable.length > 0 && usable.length <= maxEasyHits && top >= cosineFloor ? "easy" : "hard";
}

export class RoutingSynthesizer implements Synthesizer {
  constructor(
    private readonly cheap: Synthesizer,
    private readonly strong: Synthesizer,
    private readonly opts: { cosineFloor?: number; maxEasyHits?: number } = {}
  ) {}

  async synthesize(query: string, hits: SearchHit[], opts: SynthesizeOpts = {}): Promise<Synthesis> {
    const route = difficulty(hits, this.opts);
    return (route === "easy" ? this.cheap : this.strong).synthesize(query, hits, opts);
  }
}
