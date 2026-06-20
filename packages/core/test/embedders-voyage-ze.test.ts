import { test } from "node:test";
import assert from "node:assert/strict";
import { VoyageEmbedder } from "../src/core/providers/voyage-embedder.js";
import { ZeroEntropyEmbedder } from "../src/core/providers/zeroentropy-embedder.js";
import { embedderFromEnv } from "../src/core/openai-embedder.js";
import { fitDim } from "../src/core/providers/common.js";
import type { FetchLike } from "../src/core/openai-embedder.js";

function mockFetch(
  makeBody: (req: Record<string, unknown>) => unknown,
  capture?: (req: Record<string, unknown>) => void
): FetchLike {
  return async (_url, init) => {
    const req = JSON.parse(init.body) as Record<string, unknown>;
    capture?.(req);
    const body = makeBody(req);
    return { ok: true, status: 200, async text() { return ""; }, async json() { return body; } };
  };
}
const normOf = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));

test("fitDim: uzunsa keser, kısaysa sıfırla doldurur, eşitse aynı", () => {
  assert.equal(fitDim(new Array(2048).fill(1), 1536).length, 1536);
  assert.deepEqual(fitDim([1, 2], 4), [1, 2, 0, 0]);
  assert.deepEqual(fitDim([1, 2, 3], 3), [1, 2, 3]);
});

test("VoyageEmbedder: 1536 normalize üretir; output_dimension=2048 + input_type gönderir", async () => {
  let sent: Record<string, unknown> = {};
  const fetchImpl = mockFetch(
    (req) => ({ data: (req.input as string[]).map((_, i) => ({ index: i, embedding: new Array(2048).fill(i + 1) })) }),
    (req) => {
      sent = req;
    }
  );
  const e = new VoyageEmbedder({ apiKey: "k", inputType: "document", fetchImpl });
  const out = await e.embed(["a", "b"]);
  assert.equal(sent.output_dimension, 2048, "1536 için en küçük desteklenen ≥ = 2048");
  assert.equal(sent.input_type, "document");
  assert.equal(out.length, 2);
  assert.equal(out[0].length, 1536, "fitDim → 1536");
  assert.ok(Math.abs(normOf(out[1]) - 1) < 1e-6, "l2 normalize");
});

test("ZeroEntropyEmbedder: results[].embedding okur; dimensions=2560; 1536'ya fit", async () => {
  let sent: Record<string, unknown> = {};
  const fetchImpl = mockFetch(
    (req) => ({ results: (req.input as string[]).map((_, i) => ({ index: i, embedding: new Array(2560).fill(0.5) })) }),
    (req) => {
      sent = req;
    }
  );
  const e = new ZeroEntropyEmbedder({ apiKey: "k", inputType: "query", latency: "fast", fetchImpl });
  const out = await e.embed(["x"]);
  assert.equal(sent.dimensions, 2560, "1536 için en küçük desteklenen ≥ = 2560");
  assert.equal(sent.input_type, "query");
  assert.equal(sent.latency, "fast");
  assert.equal(out[0].length, 1536);
  assert.ok(Math.abs(normOf(out[0]) - 1) < 1e-6);
});

test("embedderFromEnv: voyage/zeroentropy dispatch + eksik key fırlatır", () => {
  assert.ok(embedderFromEnv({ VITRUS_EMBED_PROVIDER: "voyage", VOYAGE_API_KEY: "k" }) instanceof VoyageEmbedder);
  assert.ok(embedderFromEnv({ VITRUS_EMBED_PROVIDER: "zeroentropy", ZEROENTROPY_API_KEY: "k" }) instanceof ZeroEntropyEmbedder);
  assert.throws(() => embedderFromEnv({ VITRUS_EMBED_PROVIDER: "voyage" }), /VOYAGE_API_KEY/);
  assert.throws(() => embedderFromEnv({ VITRUS_EMBED_PROVIDER: "zeroentropy" }), /ZEROENTROPY_API_KEY/);
});
