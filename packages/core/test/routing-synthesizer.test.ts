import { test } from "node:test";
import assert from "node:assert/strict";
import { difficulty, RoutingSynthesizer } from "../src/core/routing-synthesizer.js";
import type { SearchHit, KnowledgeNode, Synthesis } from "../src/core/types.js";
import type { Synthesizer } from "../src/core/synthesizer.js";

function hit(content: string, cosine: number): SearchHit {
  const node = { id: content, slug: content, type: "note", tier: "working", title: content, content, frontmatter: {}, salience: 0.5, provenance: { connector: null, sourceId: null, uri: null, capturedAt: null }, acl: [], createdAt: "", updatedAt: "", contentHash: "" } as KnowledgeNode;
  return { node, score: 0.1, boosts: { cosine } };
}

test("difficulty: az+güçlü → easy; çok / zayıf / boş → hard", () => {
  assert.equal(difficulty([hit("a", 0.6)]), "easy");
  assert.equal(difficulty([hit("a", 0.6), hit("b", 0.55)]), "easy"); // 2 hit hâlâ kolay
  assert.equal(difficulty([hit("a", 0.6), hit("b", 0.55), hit("c", 0.4)]), "hard"); // 3 hit → zor
  assert.equal(difficulty([hit("a", 0.2)]), "hard"); // zayıf benzerlik
  assert.equal(difficulty([]), "hard"); // kaynak yok
});

test("RoutingSynthesizer: kolay → cheap (sıfır token), zor → strong (LLM)", async () => {
  const calls: string[] = [];
  const stub = (tag: string): Synthesizer => ({
    async synthesize(): Promise<Synthesis> {
      calls.push(tag);
      return { answer: tag, citations: [] };
    },
  });
  const router = new RoutingSynthesizer(stub("cheap"), stub("strong"));

  await router.synthesize("q", [hit("a", 0.6)]); // easy → cheap
  await router.synthesize("q", [hit("a", 0.6), hit("b", 0.55), hit("c", 0.4)]); // hard → strong

  assert.deepEqual(calls, ["cheap", "strong"]);
});
