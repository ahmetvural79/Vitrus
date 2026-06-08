// src/eval/dataset.ts
// Eval seti v1 — örnek korpus ("incident nasıl çözülür") için elde tutulan gerçek.
// Connector verisi geldiğinde (T3/T4/T5) bu set gerçek sorularla büyütülür.

import type { Gap } from "../core/types.js";

/** Bilinen-gerçek: soru → top-K aramada GÖRÜNMESİ gereken kaynak slug'ları. */
export interface RetrievalCase {
  id: string;
  query: string;
  expect: string[]; // hepsi top-K içinde olmalı (kaynak isabeti)
}

/** Boşluk-tespiti: bilerek bırakılmış boşluk → findGaps işaretlemeli. */
export interface GapCase {
  label: string;
  kind: Gap["kind"];
  /** Eşleşme: message alt-dizgisi VEYA relatedNodeIds üyesi. */
  match: string;
}

export const RETRIEVAL_CASES: RetrievalCase[] = [
  { id: "rate-limit", query: "rate limit eşiği kaç rps", expect: ["durable/decisions/0007-rate-limit"] },
  { id: "outage-when", query: "gateway kesintisi 503", expect: ["durable/incidents/2026-05-12-gateway-outage"] },
  { id: "who-resolved", query: "kesintiyi çözen kişi alice on-call", expect: ["durable/people/alice"] },
  { id: "team-owns", query: "platform ekibi sahip servis", expect: ["durable/teams/platform"] },
  { id: "auth-service", query: "auth servisi kimlik token", expect: ["durable/services/auth"] },
  { id: "policy", query: "incident müdahale politikası runbook", expect: ["durable/policies/incident-response"] },
  { id: "postmortem", query: "postmortem toplantısı aksiyon", expect: ["working/meetings/2026-05-13-postmortem"] },
  { id: "customer", query: "acme müşteri fintech", expect: ["durable/companies/acme"] },
  { id: "manager", query: "bob mühendislik yöneticisi", expect: ["durable/people/bob"] },
  { id: "concept", query: "rate limiting kavram istek hızı", expect: ["durable/concepts/rate-limiting"] },
  { id: "gateway-dep", query: "api gateway bağımlı giriş noktası", expect: ["durable/services/api-gateway"] },
  { id: "ciso", query: "carol ciso güvenlik danışman", expect: ["durable/people/carol"] },
];

export const GAP_CASES: GapCase[] = [
  { label: "belgelenmemiş status-page", kind: "missing", match: "status-page" },
  { label: "1000rps vs 500rps çelişki", kind: "contradiction", match: "durable/decisions/0007-rate-limit" },
  { label: "0003 süpersede edildi", kind: "stale", match: "0003-rate-limit" },
  { label: "escalation tek kişide", kind: "single_point", match: "durable/policies/incident-response" },
];
