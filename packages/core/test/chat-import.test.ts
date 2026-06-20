// test/chat-import.test.ts — ChatGPT/Claude export import.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatExportToRecords } from "../src/connectors/chat-import.js";

const NOW = "2026-06-21T00:00:00Z";

test("chat-import: ChatGPT mapping → note (create_time sırası korunur)", () => {
  const recs = chatExportToRecords(
    [
      {
        title: "Rate limits",
        id: "c1",
        mapping: {
          b: { message: { author: { role: "assistant" }, content: { parts: ["Set it to 100 rps."] }, create_time: 2 } },
          a: { message: { author: { role: "user" }, content: { parts: ["What rate limit?"] }, create_time: 1 } },
        },
      },
    ],
    { now: NOW }
  );
  assert.equal(recs.length, 1);
  assert.equal(recs[0].type, "note");
  assert.equal(recs[0].title, "Rate limits");
  assert.ok(recs[0].content.indexOf("What rate limit") < recs[0].content.indexOf("100 rps"), "create_time sırası");
  assert.ok(recs[0].slug.startsWith("working/chat/"), recs[0].slug);
});

test("chat-import: Claude chat_messages → note", () => {
  const recs = chatExportToRecords(
    [{ name: "Design chat", uuid: "u1", chat_messages: [{ sender: "human", text: "How should we cache?" }, { sender: "assistant", text: "Use Redis for the hot path." }] }],
    { now: NOW }
  );
  assert.equal(recs.length, 1);
  assert.equal(recs[0].title, "Design chat");
  assert.ok(recs[0].content.includes("Redis"));
});

test("chat-import: boş/tanınmayan konuşmalar atlanır", () => {
  const recs = chatExportToRecords([{ foo: "bar" }, { mapping: {} }, { chat_messages: [] }], { now: NOW });
  assert.equal(recs.length, 0);
});
