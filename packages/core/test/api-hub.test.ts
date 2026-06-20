// M1 Faz B: api-hub — normalize + deterministik verify-guard + retrieve round-trip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeOpenApi, cardToNode } from "../src/api-hub/normalize.js";
import { verifyApiCall } from "../src/api-hub/verify-call.js";
import { apiSearch, nodeToCard } from "../src/api-hub/retrieve.js";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";

const SPEC = {
  info: { title: "petstore" },
  servers: [{ url: "https://api.petstore.io/v1" }],
  paths: {
    "/pets": {
      get: {
        operationId: "listPets",
        summary: "List all pets",
        parameters: [
          { name: "limit", in: "query", required: false, schema: { type: "integer" } },
          { name: "status", in: "query", required: true, schema: { type: "string", enum: ["available", "sold"] } },
        ],
      },
      post: {
        operationId: "createPet",
        summary: "Create a new pet record",
        requestBody: { required: true, content: { "application/json": { schema: { properties: { name: {}, tag: {} } } } } },
      },
    },
    "/pets/{petId}": {
      get: { operationId: "getPet", summary: "Get a pet by id", parameters: [{ name: "petId", in: "path", required: true, schema: { type: "integer" } }] },
      delete: { operationId: "deletePet", summary: "Delete a pet", deprecated: true, parameters: [{ name: "petId", in: "path", required: true, schema: { type: "integer" } }] },
    },
  },
};
const cards = normalizeOpenApi(SPEC);
const byId = (id: string) => cards.find((c) => c.operationId === id)!;

test("normalize: OpenAPI 3 → 4 kart, param/body/deprecated doğru", () => {
  assert.equal(cards.length, 4);
  const lp = byId("listPets");
  assert.equal(lp.method, "GET");
  assert.equal(lp.path, "/pets");
  assert.equal(lp.baseUrl, "https://api.petstore.io/v1");
  assert.ok(lp.parameters.find((p) => p.name === "status")?.required);
  assert.deepEqual(lp.parameters.find((p) => p.name === "status")?.enum, ["available", "sold"]);
  const cp = byId("createPet");
  assert.ok(cp.requestBody?.required);
  assert.deepEqual(cp.requestBody?.fields, ["name", "tag"]);
  assert.equal(byId("getPet").parameters.find((p) => p.name === "petId")?.in, "path");
  assert.ok(byId("deletePet").deprecated);
});

test("verify-guard: valid / missing / wrong-type / enum / unknown-arg / deprecated / hallucination", () => {
  assert.equal(verifyApiCall(byId("getPet"), { petId: 5 }).status, "valid");
  assert.equal(verifyApiCall(byId("getPet"), {}).status, "missing_args");
  assert.equal(verifyApiCall(byId("getPet"), { petId: "not-a-number" }).status, "wrong_type");
  assert.equal(verifyApiCall(byId("getPet"), { petId: 5, foo: 1 }).status, "unknown_args");
  assert.equal(verifyApiCall(byId("listPets"), { status: "available" }).status, "valid");
  assert.equal(verifyApiCall(byId("listPets"), { status: "bad" }).status, "wrong_type");
  assert.equal(verifyApiCall(byId("listPets"), {}).status, "missing_args");
  assert.equal(verifyApiCall(byId("createPet"), { name: "Rex" }).status, "valid");
  assert.equal(verifyApiCall(byId("createPet"), {}).status, "missing_args");
  const dep = verifyApiCall(byId("deletePet"), { petId: 5 });
  assert.equal(dep.status, "deprecated");
  assert.ok(dep.ok, "deprecated yine çalıştırılabilir (ok=true) ama uyarılı");
  const hall = verifyApiCall(undefined, { x: 1 });
  assert.equal(hall.status, "unknown_endpoint");
  assert.equal(hall.ok, false);
});

test("retrieve round-trip: cardToNode → index → apiSearch bulur → nodeToCard", async () => {
  const e = new PgliteEngine({ embedder: new HashingEmbedder() });
  await e.init();
  try {
    for (const c of cards) await e.putNode(cardToNode(c));
    const hits = await apiSearch(e, "get a single pet by its id", { limit: 5 });
    assert.ok(hits.length > 0, "api_endpoint sonucu dönmeli");
    assert.ok(hits.every((h) => h.card.operationId), "hepsi geçerli kart");
    assert.ok(hits.some((h) => h.card.operationId === "getPet"), "getPet bulunmalı");
    // nodeToCard tersine-parse
    const node = cardToNode(byId("createPet"));
    assert.equal(nodeToCard(node.frontmatter)?.operationId, "createPet");
  } finally {
    await e.close();
  }
});
