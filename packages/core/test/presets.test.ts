// test/presets.test.ts — 8 REST connector preset altyapısı (token'sız, enjekte fetch ile deterministik).
import { test } from "node:test";
import assert from "node:assert/strict";
import { RestConnector, CONNECTOR_PRESETS, presetToConfig, type RestFetch } from "../src/connectors/index.js";

// Sahte fetch: sabit JSON payload döndürür (token/ağ yok → deterministik).
function mockFetch(payload: unknown): RestFetch {
  return async () => ({ ok: true, status: 200, text: async () => "", json: async () => payload });
}
const NOW = "2026-06-20T00:00:00Z";

test("presets: 8 connector tanımlı + her biri url/slugPrefix/auth taşır", () => {
  const names = ["stripe", "hubspot", "salesforce", "asana", "teams", "dropbox", "figma", "zoom"];
  for (const n of names) {
    const p = CONNECTOR_PRESETS[n];
    assert.ok(p, `${n} preset var`);
    assert.ok(p.url.startsWith("https://"), `${n} url https`);
    assert.ok(p.slugPrefix.startsWith("working/"), `${n} slugPrefix`);
    assert.ok(p.auth.type === "bearer" || p.auth.type === "header", `${n} auth tipi`);
    assert.ok(p.tokenLabel.length > 0, `${n} tokenLabel`);
  }
  assert.equal(Object.keys(CONNECTOR_PRESETS).length, 8);
});

test("presets: Stripe customers → document node (itemsPath=data, titleField=email)", async () => {
  const conn = new RestConnector(
    { ...presetToConfig("stripe", CONNECTOR_PRESETS.stripe), auth: { type: "bearer", token: "sk_test_x" } },
    { now: NOW, fetchImpl: mockFetch({ data: [{ id: "cus_1", email: "a@b.com" }, { id: "cus_2", email: "c@d.com" }] }) }
  );
  const recs = await conn.fetch();
  assert.equal(recs.length, 2);
  assert.equal(recs[0].type, "document");
  assert.equal(recs[0].title, "a@b.com");
  assert.equal(recs[0].sourceId, "cus_1");
  assert.ok(recs[0].slug.startsWith("working/stripe/"), recs[0].slug);
});

test("presets: HubSpot nested titleField (properties.email) çözülür", async () => {
  const conn = new RestConnector(
    { ...presetToConfig("hubspot", CONNECTOR_PRESETS.hubspot), auth: { type: "bearer", token: "x" } },
    { now: NOW, fetchImpl: mockFetch({ results: [{ id: "1", properties: { email: "nested@h.com" } }] }) }
  );
  const recs = await conn.fetch();
  assert.equal(recs.length, 1);
  assert.equal(recs[0].title, "nested@h.com"); // nokta-yolu çözüldü
});

test("presets: Figma header-auth + tek-nesne yanıt (itemsPath boş) → 1 node", async () => {
  const conn = new RestConnector(
    { ...presetToConfig("figma", CONNECTOR_PRESETS.figma), auth: { type: "header", header: "x-figma-token", token: "figd_x" } },
    { now: NOW, fetchImpl: mockFetch({ id: "u1", email: "me@figma.com" }) }
  );
  const recs = await conn.fetch();
  assert.equal(recs.length, 1);
  assert.equal(recs[0].title, "me@figma.com");
  assert.ok(recs[0].slug.startsWith("working/figma/"), recs[0].slug);
});

test("presets: Zoom meetings → meeting node (itemsPath=meetings, titleField=topic)", async () => {
  const conn = new RestConnector(
    { ...presetToConfig("zoom", CONNECTOR_PRESETS.zoom), auth: { type: "bearer", token: "x" } },
    { now: NOW, fetchImpl: mockFetch({ meetings: [{ id: 99, topic: "Sprint planning" }] }) }
  );
  const recs = await conn.fetch();
  assert.equal(recs[0].type, "meeting");
  assert.equal(recs[0].title, "Sprint planning");
});
