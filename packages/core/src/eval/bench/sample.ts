// src/eval/bench/sample.ts
// Küçük, GÖMÜLÜ örnek dataset (LongMemEval tarzı çok-oturumlu hafıza). Offline +
// deterministik (HashingEmbedder ile) → harness'ın doğru skorladığını kanıtlar.
// Gerçek SOTA ölçümü için `bench --dataset <longmemeval.json>` + gerçek embedder.
// (Anahtar kelimeler bilerek hizalı; HashingEmbedder semantik değil — bkz. loaders/BYO.)

import type { BenchDataset } from "./types.js";

export const SAMPLE_DATASET: BenchDataset = {
  name: "vitrus-sample (LongMemEval-style)",
  items: [
    { id: "s1", content: "Session January: the user mentioned they are allergic to peanuts and shellfish.", capturedAt: "2026-01-10T09:00:00Z" },
    { id: "s2", content: "Session February: the user said they work at Acme Corporation as a designer.", capturedAt: "2026-02-05T09:00:00Z" },
    { id: "s3", content: "Session March: the user adopted a dog; the dog is named Rex.", capturedAt: "2026-03-12T09:00:00Z" },
    { id: "s4", content: "Session April: the user changed jobs and now works at Globex, no longer at Acme.", capturedAt: "2026-04-20T09:00:00Z" },
    { id: "s5", content: "Session May: the user is planning a trip to Japan in the autumn.", capturedAt: "2026-05-02T09:00:00Z" },
  ],
  queries: [
    { id: "q1", category: "single-session", question: "what is the user allergic to", expectSources: ["s1"], expectAnswer: "peanuts" },
    { id: "q2", category: "single-session", question: "what is the name of the user dog", expectSources: ["s3"], expectAnswer: "Rex" },
    { id: "q3", category: "single-session", question: "where is the user planning a trip", expectSources: ["s5"], expectAnswer: "Japan" },
    { id: "q4", category: "knowledge-update", question: "where does the user work now", expectSources: ["s4"], expectAnswer: "Globex" },
  ],
};
