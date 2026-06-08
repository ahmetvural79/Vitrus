// src/eval/bench/types.ts
// C1 — portatif hafıza-benchmark formatı (LongMemEval / LoCoMo tarzı). Korpus (items) +
// soru seti (queries: hangi kaynak getirilmeli + beklenen cevap). Harness bunu Vitrus'a
// ingest edip retrieval recall + cevap doğruluğunu objektif ölçer.

export interface BenchItem {
  id: string;
  content: string;
  capturedAt?: string | null;
  scope?: string;
}

export interface BenchQuery {
  id: string;
  question: string;
  /** Top-K'da görünmesi gereken item id'leri (retrieval recall). */
  expectSources: string[];
  /** Beklenen cevap parçası (cevap doğruluğu; yoksa yalnız retrieval ölçülür). */
  expectAnswer?: string;
  category?: string;
}

export interface BenchDataset {
  name: string;
  items: BenchItem[];
  queries: BenchQuery[];
}

export interface BenchCaseResult {
  id: string;
  category: string;
  recall: number; // |expect ∩ got| / |expect|
  hit: boolean; // recall === 1
  expect: string[];
  got: string[];
  answerHit: boolean | null; // null = beklenen cevap yok
}

export interface BenchReport {
  name: string;
  total: number;
  topK: number;
  retrieval: { recall: number; hitRate: number };
  answer: { total: number; correct: number; accuracy: number };
  categories: Record<string, { total: number; hitRate: number; answerAccuracy: number }>;
  cases: BenchCaseResult[];
}
