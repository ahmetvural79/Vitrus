import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EmailConnector, slugifyPerson } from "../src/connectors/email.js";
import { CalendarConnector } from "../src/connectors/calendar.js";
import { PgliteEngine } from "../src/core/pglite-engine.js";
import { HashingEmbedder } from "../src/core/hashing-embedder.js";
import { ingest } from "../src/connectors/ingest.js";

const EMAILS = join(tmpdir(), "gb-emails-test.json");
const EVENTS = join(tmpdir(), "gb-events-test.json");

test("EmailConnector: katılımcı ACL (user) + people auto-link + slug + tarih", async () => {
  writeFileSync(EMAILS, JSON.stringify([
    { id: "m1", from: "alice@x.com", to: ["bob@x.com"], subject: "Kesinti", date: "2026-01-01T00:00:00Z", body: "ödeme servisi çöktü" },
    { id: "m2", from: "carol@x.com", subject: "Duyuru", body: "herkese açık", public: true },
  ]));
  const recs = await new EmailConnector(EMAILS).fetch();
  assert.equal(recs.length, 2);
  assert.equal(recs[0].slug, "working/email/m1");
  assert.equal(recs[0].title, "Kesinti");
  assert.equal(recs[0].type, "document");
  assert.deepEqual(recs[0].acl.map((a) => a.principal).sort(), ["alice@x.com", "bob@x.com"]);
  assert.ok(recs[0].acl.every((a) => a.kind === "user"));
  assert.match(recs[0].content, /\[\[durable\/people\/alice\]\]/);
  assert.equal(recs[0].capturedAt, "2026-01-01T00:00:00Z");
  assert.equal(recs[1].acl[0].kind, "public"); // public:true → org-geneli
});

test("slugifyPerson: e-posta local-part / ad → slug", () => {
  assert.equal(slugifyPerson("Alice.Smith@x.com"), "alice-smith");
  assert.equal(slugifyPerson("Bob"), "bob");
});

test("CalendarConnector: meeting tipi + attendee ACL + zaman/yer", async () => {
  writeFileSync(EVENTS, JSON.stringify({ events: [
    { id: "e1", title: "Sprint", start: "2026-02-01T10:00:00Z", attendees: ["alice@x.com", "bob@x.com"], description: "planlama", location: "Oda 3" },
  ] }));
  const recs = await new CalendarConnector(EVENTS).fetch();
  assert.equal(recs[0].type, "meeting");
  assert.equal(recs[0].slug, "working/calendar/e1");
  assert.equal(recs[0].capturedAt, "2026-02-01T10:00:00Z");
  assert.deepEqual(recs[0].acl.map((a) => a.principal).sort(), ["alice@x.com", "bob@x.com"]);
  assert.match(recs[0].content, /Oda 3/);
  assert.match(recs[0].content, /\[\[durable\/people\/bob\]\]/);
});

test("ingest email → motor: fail-closed ACL (yalnız katılımcı görür)", async () => {
  writeFileSync(EMAILS, JSON.stringify([
    { id: "m1", from: "alice@x.com", to: ["bob@x.com"], subject: "Gizli", body: "ödeme sırrı kesinti" },
  ]));
  const engine = new PgliteEngine({ embedder: new HashingEmbedder() });
  await engine.init();
  await ingest(engine, new EmailConnector(EMAILS));

  const asAlice = await engine.search("ödeme sırrı kesinti", { limit: 5, principals: ["alice@x.com"] });
  assert.ok(asAlice.some((h) => h.node.slug === "working/email/m1")); // katılımcı görür

  const asEve = await engine.search("ödeme sırrı kesinti", { limit: 5, principals: ["eve@x.com"] });
  assert.equal(asEve.some((h) => h.node.slug === "working/email/m1"), false); // yetkisiz görmez
  await engine.close();
});
