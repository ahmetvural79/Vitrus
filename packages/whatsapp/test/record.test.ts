// packages/whatsapp/test/record.test.ts
// Saf çekirdeğin testi — Baileys/oturum GEREKMEZ (record.ts sadece SourceRecord *tipini* alır).
// node --test --import tsx (repo geneli koşucu).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatAnswerForWhatsApp,
  isAddressedToBot,
  jidLocal,
  parseControlCommand,
  stripTrigger,
  waGroupMessageToRecord,
  WA_GROUP_SLUG_PREFIX,
} from "../src/record.js";

test("waGroupMessageToRecord", async (t) => {
  const rec = waGroupMessageToRecord(
    {
      groupJid: "12036@g.us",
      groupSubject: "Ada · Meridyen Projesi",
      msgId: "ABC123",
      senderJid: "905551112233@s.whatsapp.net",
      senderName: "Kerem",
      text: "SSO teslim tarihi Cuma",
      tsSeconds: 1_700_000_000,
    },
    { retentionDays: 90 },
  );

  await t.test("slug = grup-local + msgId", () => {
    assert.equal(rec.slug, `${WA_GROUP_SLUG_PREFIX}12036/ABC123`);
  });
  await t.test("ACL grup-başına fail-closed", () => {
    assert.deepEqual(rec.acl, [{ kind: "group", principal: "whatsapp-group:12036" }]);
  });
  await t.test("içerik gönderen + grup adı + metni taşır", () => {
    assert.match(rec.content, /Meridyen Projesi/);
    assert.match(rec.content, /Kerem/);
    assert.match(rec.content, /SSO teslim tarihi Cuma/);
  });
  await t.test("capturedAt ISO + retention", () => {
    assert.equal(rec.capturedAt, new Date(1_700_000_000 * 1000).toISOString());
    assert.equal(rec.retentionDays, 90);
  });
  await t.test("sourceId idempotent = msgId", () => {
    assert.equal(rec.sourceId, "ABC123");
    assert.equal(rec.type, "note");
    assert.equal(rec.tier, "working");
  });
});

test("isAddressedToBot — read-mostly kapısı", async (t) => {
  await t.test("trigger ile başlar → evet", () => {
    assert.equal(isAddressedToBot("vitrus deploy politikası ne?", [], undefined), true);
    assert.equal(isAddressedToBot("@vitrus özet ver", [], undefined), true);
    assert.equal(isAddressedToBot("/vitrus durum", [], undefined), true);
  });
  await t.test("sıradan grup mesajı → hayır", () => {
    assert.equal(isAddressedToBot("toplantı 3'te", [], undefined), false);
  });
  await t.test("mention ile (device-suffix'e rağmen eşleşir)", () => {
    assert.equal(isAddressedToBot("bak buna", ["999@s.whatsapp.net"], "999:1@s.whatsapp.net"), true);
  });
});

test("parseControlCommand — opt-out/rıza", () => {
  assert.equal(parseControlCommand("/vitrus off"), "off");
  assert.equal(parseControlCommand("vitrus dur"), "off");
  assert.equal(parseControlCommand("/vitrus on"), "on");
  assert.equal(parseControlCommand("normal mesaj"), null);
});

test("stripTrigger — soruyu ayıkla", () => {
  assert.equal(stripTrigger("vitrus, deploy politikası ne?"), "deploy politikası ne?");
  assert.equal(stripTrigger("@vitrus özet"), "özet");
});

test("formatAnswerForWhatsApp — cevap + kaynak + cam-kutu gap", () => {
  const out = formatAnswerForWhatsApp({
    answer: "SSO ve CSV, Q3 sonuna kadar.",
    sources: [{ title: "Meridyen Kurumsal Sözleşmesi" }],
    gap: "CSV teslim tarihi belgelenmemiş.",
  });
  assert.match(out, /SSO ve CSV/);
  assert.match(out, /\[1\] Meridyen Kurumsal Sözleşmesi/);
  assert.match(out, /Bilmediğim: CSV teslim tarihi/);
});

test("jidLocal — @ ve : eklerini soyar", () => {
  assert.equal(jidLocal("12036@g.us"), "12036");
  assert.equal(jidLocal("905551112233@s.whatsapp.net"), "905551112233");
  assert.equal(jidLocal("999:1@s.whatsapp.net"), "999");
});
