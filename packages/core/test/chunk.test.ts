import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkText, meanPool } from "../src/sync/chunk.js";

test("kısa metin → tek chunk", () => {
  const c = chunkText("Kısa bir not.");
  assert.equal(c.length, 1);
  assert.equal(c[0].content, "Kısa bir not.");
});

test("uzun metin başlık/paragraf sınırında bölünür", () => {
  const text = ["# A", "x".repeat(300), "", "# B", "y".repeat(300), "", "# C", "z".repeat(300)].join("\n");
  const c = chunkText(text, { maxChars: 350 });
  assert.ok(c.length >= 2, "birden çok chunk olmalı");
  // hiçbir chunk maxChars'ı (büyük marjla) aşmamalı
  assert.ok(c.every((x) => x.content.length <= 360));
});

test("kod fence'i bütün kalır", () => {
  const text = `Açıklama paragrafı.\n\n\`\`\`ts\nconst a = 1;\nconst b = 2;\n\`\`\`\n\nSon paragraf.`;
  const c = chunkText(text, { maxChars: 30 });
  // fence içeren chunk hem açılış hem kapanış ``` içermeli (bölünmemiş)
  const fenceChunk = c.find((x) => x.content.includes("const a"));
  assert.ok(fenceChunk);
  assert.equal((fenceChunk!.content.match(/```/g) ?? []).length, 2);
});

test("meanPool: tek vektör → kendisi (normalize); davranış değişmez", () => {
  const v = [0.6, 0.8]; // zaten birim
  assert.deepEqual(meanPool([v]).map((x) => Math.round(x * 100) / 100), [0.6, 0.8]);
});

test("meanPool: ortalama L2-normalize", () => {
  const pooled = meanPool([[1, 0], [0, 1]]);
  const norm = Math.hypot(pooled[0], pooled[1]);
  assert.ok(Math.abs(norm - 1) < 1e-9);
});
