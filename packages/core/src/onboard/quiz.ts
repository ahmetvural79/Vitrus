// src/onboard/quiz.ts
// M2 — bilgi sınavı (aktif geri-çağırma): yüksek-ilgili node'lardan soru üret; cevabı `verify` ile
// DETERMİNİSTİK notla (grounded=1 / stale=0.5 / contradicted|unsupported=0). LLM'siz notlama.

import type { BrainEngine } from "../core/engine.js";
import { verifyClaim } from "../verify/verify.js";

export interface QuizQuestion { slug: string; type: string; question: string }
export interface GradeResult { verdict: string; score: number; confidence: number; support: { slug: string }[] }

const leaf = (slug: string) => { const p = slug.split("/"); return p[p.length - 1] || slug; };

function questionFor(node: { type: string; title: string; slug: string }): string {
  const name = node.title || leaf(node.slug);
  switch (node.type) {
    case "service": return `Who owns the "${name}" service, and what does it do?`;
    case "decision": return `What was decided in "${name}", and what was the rationale?`;
    case "person": return `What does "${name}" own or work on?`;
    case "incident": return `How was the "${name}" incident resolved?`;
    case "policy": return `What does the "${name}" policy require?`;
    default: return `Explain "${name}" in your own words.`;
  }
}

export async function generateQuiz(
  engine: BrainEngine,
  topic: string,
  opts: { count?: number; principals?: string[] } = {}
): Promise<QuizQuestion[]> {
  const count = opts.count ?? 5;
  const hits = await engine.search(topic, { limit: 20, principals: opts.principals });
  const out: QuizQuestion[] = [];
  for (const h of hits) {
    if (["session", "source", "note"].includes(h.node.type)) continue;
    out.push({ slug: h.node.slug, type: h.node.type, question: questionFor(h.node) });
    if (out.length >= count) break;
  }
  return out;
}

/** Cevabı beyne karşı doğrula → skor. Asla self-report'a güvenme (verify deterministik). */
export async function gradeAnswer(engine: BrainEngine, answer: string, principals?: string[]): Promise<GradeResult> {
  const r = await verifyClaim(engine, answer, { principals });
  const score = r.status === "grounded" ? 1 : r.status === "stale" ? 0.5 : 0;
  return { verdict: r.status, score, confidence: r.confidence, support: r.support };
}
