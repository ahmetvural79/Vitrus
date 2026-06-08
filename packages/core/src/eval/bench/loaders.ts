// src/eval/bench/loaders.ts
// BYO gerçek dataset yükleyici: LongMemEval / LoCoMo JSON → BenchDataset. Alan adları
// sürüme göre değişebilir → toleranslı (birkaç alternatif anahtar dener). Gerçek SOTA
// ölçümü için `bench --dataset <path>` + gerçek embedder (OPENAI_API_KEY).

import type { BenchDataset, BenchItem, BenchQuery } from "./types.js";

function turnsToText(session: unknown): string {
  if (typeof session === "string") return session;
  if (Array.isArray(session))
    return session
      .map((t: unknown) =>
        typeof t === "string"
          ? t
          : t && typeof t === "object"
            ? `${(t as Record<string, unknown>).role ?? "?"}: ${(t as Record<string, unknown>).content ?? (t as Record<string, unknown>).text ?? ""}`
            : ""
      )
      .join("\n");
  return JSON.stringify(session);
}

/** LongMemEval-benzeri kayıt listesi (veya {questions:[...]}) → BenchDataset. */
export function loadLongMemEval(json: unknown): BenchDataset {
  const rows: Record<string, unknown>[] = Array.isArray(json)
    ? (json as Record<string, unknown>[])
    : ((json as { questions?: Record<string, unknown>[] }).questions ?? []);

  const items = new Map<string, BenchItem>();
  const queries: BenchQuery[] = [];

  for (const r of rows) {
    const qid = String(r.question_id ?? r.id ?? `q${queries.length}`);
    const sessions = (r.haystack_sessions ?? r.sessions ?? []) as unknown[];
    const sessionIds = (r.haystack_session_ids ?? r.session_ids ?? sessions.map((_, i) => `${qid}-s${i}`)) as unknown[];
    sessions.forEach((s, i) => {
      const id = String(sessionIds[i] ?? `${qid}-s${i}`);
      if (!items.has(id)) items.set(id, { id, content: turnsToText(s) });
    });
    queries.push({
      id: qid,
      question: String(r.question ?? ""),
      expectSources: ((r.answer_session_ids ?? r.evidence_session_ids ?? []) as unknown[]).map(String),
      expectAnswer: r.answer != null ? String(r.answer) : undefined,
      category: (r.question_type ?? r.category) as string | undefined,
    });
  }

  return { name: "LongMemEval (loaded)", items: [...items.values()], queries };
}

/**
 * LoCoMo (long-term conversational memory) → BenchDataset. Her örnek `conversation`
 * (session_N + opsiyonel session_N_date_time) + `qa` (question/answer/evidence/category).
 * evidence = dia_id'ler → ait oldukları session item'ına eşlenir (retrieval recall hedefi).
 * Alan adları sürüme göre değişebilir → toleranslı (birkaç alternatif anahtar).
 */
export function loadLoCoMo(json: unknown): BenchDataset {
  const samples = (Array.isArray(json) ? json : [json]) as Record<string, unknown>[];
  const items: BenchItem[] = [];
  const queries: BenchQuery[] = [];

  samples.forEach((s, si) => {
    const conv = (s.conversation ?? s) as Record<string, unknown>;
    const diaToItem = new Map<string, string>();

    for (const key of Object.keys(conv)) {
      if (!/^session_\d+$/.test(key)) continue;
      const turns = conv[key];
      if (!Array.isArray(turns)) continue;
      const itemId = `s${si}-${key}`;
      const dt = conv[`${key}_date_time`];
      const lines: string[] = [];
      for (const t of turns) {
        const turn = (t ?? {}) as Record<string, unknown>;
        const speaker = String(turn.speaker ?? turn.role ?? "?");
        const txt = String(turn.text ?? turn.content ?? turn.clean_text ?? "");
        const dia = turn.dia_id ?? turn.id;
        if (dia != null) diaToItem.set(String(dia), itemId);
        lines.push(`${speaker}: ${txt}`);
      }
      items.push({ id: itemId, content: lines.join("\n"), capturedAt: typeof dt === "string" ? dt : null });
    }

    const qa = (s.qa ?? s.qas ?? []) as Record<string, unknown>[];
    qa.forEach((q, qi) => {
      const evidence = (q.evidence ?? q.evidences ?? []) as unknown[];
      const expectSources = [
        ...new Set(evidence.map((e) => diaToItem.get(String(e))).filter((x): x is string => !!x)),
      ];
      queries.push({
        id: `s${si}-q${qi}`,
        question: String(q.question ?? ""),
        expectSources,
        expectAnswer: q.answer != null ? String(q.answer) : undefined,
        category: q.category != null ? String(q.category) : undefined,
      });
    });
  });

  return { name: "LoCoMo (loaded)", items, queries };
}

/** Formatı içerikten algıla: `conversation`/`qa` → locomo, değilse longmemeval. */
export function detectFormat(json: unknown): "longmemeval" | "locomo" {
  const first = Array.isArray(json) ? json[0] : json;
  if (first && typeof first === "object" && ("conversation" in first || "qa" in first)) return "locomo";
  return "longmemeval";
}

/** Tek giriş noktası: format verilirse onu, yoksa otomatik algılamayı kullanır. */
export function loadDataset(json: unknown, format?: "longmemeval" | "locomo"): BenchDataset {
  const fmt = format ?? detectFormat(json);
  return fmt === "locomo" ? loadLoCoMo(json) : loadLongMemEval(json);
}

/** Soru kümesini ilk N ile sınırla (HAYSTACK item'ları tam kalır → recall gerçekçi). */
export function limitDataset(ds: BenchDataset, n: number): BenchDataset {
  if (!Number.isFinite(n) || n <= 0 || n >= ds.queries.length) return ds;
  return { ...ds, name: `${ds.name} (first ${n}q)`, queries: ds.queries.slice(0, n) };
}
