#!/usr/bin/env node
// src/eval/apieval/run.ts — API-Eval kapısı (`bun run apieval`).
// Gorilla'nın iki metriği: (1) fonksiyonel doğruluk = göreve doğru endpoint seçimi (retrieval@1/@3),
// (2) halüsinasyon = uydurma endpoint/argümanın deterministik REDDİ (verify-guard doğruluğu).
// Deterministik (HashingEmbedder); verify kapısı %100 zorunlu, exit 1 başarısızsa.

import { PgliteEngine } from "../../core/pglite-engine.js";
import { HashingEmbedder } from "../../core/hashing-embedder.js";
import { normalizeOpenApi, cardToNode } from "../../api-hub/normalize.js";
import { apiSearch, findEndpoint } from "../../api-hub/retrieve.js";
import { verifyApiCall } from "../../api-hub/verify-call.js";

const SPEC: Record<string, any> = {
  info: { title: "petstore" },
  servers: [{ url: "https://api.petstore.io/v1" }],
  paths: {
    "/pets": {
      get: {
        operationId: "listPets",
        summary: "List all pets, optionally filtered by status",
        parameters: [
          { name: "limit", in: "query", required: false, schema: { type: "integer" } },
          { name: "status", in: "query", required: true, schema: { type: "string", enum: ["available", "sold"] } },
        ],
      },
      post: { operationId: "createPet", summary: "Create / add a new pet record", requestBody: { required: true, content: { "application/json": { schema: { properties: { name: {}, tag: {} } } } } } },
    },
    "/pets/{petId}": {
      get: { operationId: "getPet", summary: "Fetch a single pet by its id", parameters: [{ name: "petId", in: "path", required: true, schema: { type: "integer" } }] },
      delete: { operationId: "deletePet", summary: "Delete / remove a pet by id", deprecated: true, parameters: [{ name: "petId", in: "path", required: true, schema: { type: "integer" } }] },
    },
    "/stores/order": {
      post: { operationId: "placeOrder", summary: "Place an order for a pet", requestBody: { required: true, content: { "application/json": { schema: { properties: { petId: {}, quantity: {} } } } } } },
    },
  },
};

const RETRIEVAL = [
  { task: "list every pet in the store", expect: "listPets" },
  { task: "get one specific pet by its id", expect: "getPet" },
  { task: "add a brand new pet record", expect: "createPet" },
  { task: "place an order for a pet", expect: "placeOrder" },
];

const VERIFY: { ref: string; args: Record<string, unknown>; expect: string }[] = [
  { ref: "getPet", args: { petId: 5 }, expect: "valid" },
  { ref: "getPet", args: {}, expect: "missing_args" },
  { ref: "getPet", args: { petId: "abc" }, expect: "wrong_type" },
  { ref: "getPet", args: { petId: 5, sortBy: "name" }, expect: "unknown_args" },
  { ref: "listPets", args: { status: "elsewhere" }, expect: "wrong_type" },
  { ref: "createPet", args: { name: "Rex" }, expect: "valid" },
  { ref: "deletePet", args: { petId: 9 }, expect: "deprecated" },
  { ref: "purgeEntireDatabase", args: {}, expect: "unknown_endpoint" },
];

const e = new PgliteEngine({ embedder: new HashingEmbedder() });
await e.init();
const cards = normalizeOpenApi(SPEC);
for (const c of cards) await e.putNode(cardToNode(c));

let r1 = 0, r3 = 0;
const retLines: string[] = [];
for (const c of RETRIEVAL) {
  const hits = await apiSearch(e, c.task, { limit: 3 });
  const ids = hits.map((h) => h.card.operationId);
  if (ids[0] === c.expect) r1++;
  if (ids.includes(c.expect)) r3++;
  else retLines.push(`  ✗ "${c.task}" → expected ${c.expect}, got ${ids.join(",") || "(none)"}`);
}

let vOk = 0;
const vLines: string[] = [];
for (const c of VERIFY) {
  const card = await findEndpoint(e, c.ref);
  const v = verifyApiCall(card, c.args);
  if (v.status === c.expect) vOk++;
  else vLines.push(`  ✗ ${c.ref} ${JSON.stringify(c.args)} → expected ${c.expect}, got ${v.status}`);
}
await e.close();

const r1pct = Math.round((r1 / RETRIEVAL.length) * 100);
const r3pct = Math.round((r3 / RETRIEVAL.length) * 100);
const vpct = Math.round((vOk / VERIFY.length) * 100);

console.log("Vitrus API-Eval · embedder=hashing-1536 · petstore (5 endpoints)\n");
console.log(`ENDPOINT SELECTION (informational — embedder-dependent): top-1 ${r1pct}% · top-3 ${r3pct}% (${r3}/${RETRIEVAL.length})`);
retLines.forEach((l) => console.log(l));
console.log(`  (offline hashing embedder; a multilingual production embedder ranks higher — see ENDPOINT SELECTION upstream)`);
console.log(`\nVERIFY-GUARD (anti-hallucination, DETERMINISTIC): ${vpct}% (${vOk}/${VERIFY.length}) · gate 100%`);
vLines.forEach((l) => console.log(l));

// Verify-guard deterministik → %100 ZORUNLU gate. Retrieval embedder-bağımlı → bilgilendirici (gate değil).
const ok = vpct === 100;
console.log(ok ? "\n✓ API-EVAL GATES PASSED" : "\n✗ API-EVAL FAILED");
process.exit(ok ? 0 : 1);
