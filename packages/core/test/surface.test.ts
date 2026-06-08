import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSurface,
  renderSurfaceText,
  renderSurfaceHtml,
  scoreConfidence,
} from "../src/surface/surface.js";
import { ExtractiveSynthesizer } from "../src/core/synthesizer.js";
import type { KnowledgeNode, SearchHit, ThinkResult } from "../src/core/types.js";

function node(slug: string, content: string, uri: string | null = null): KnowledgeNode {
  return {
    id: slug,
    slug,
    type: "note",
    tier: "durable",
    title: slug,
    content,
    frontmatter: {},
    salience: 0.5,
    provenance: { connector: null, sourceId: null, uri, capturedAt: null },
    acl: [],
    createdAt: "",
    updatedAt: "",
    contentHash: "",
  };
}
function hit(n: KnowledgeNode, cosine = 0.3): SearchHit {
  return { node: n, score: 0.02, boosts: { tier: 1.15, cosine } };
}

test("ExtractiveSynthesizer: her cümle [n] ile kaynağa bağlı; stub atlanır", async () => {
  const s = new ExtractiveSynthesizer();
  const out = await s.synthesize("rate limit", [
    hit(node("durable/decisions/0007", "Rate-limit 500 rps olarak belirlendi.", "http://d7")),
    hit(node("durable/services/x", "")), // boş → atlanmalı
  ]);
  assert.match(out.answer, /\[1\]/);
  assert.equal(out.citations.length, 1);
  assert.equal(out.citations[0].slug, "durable/decisions/0007");
});

test("ExtractiveSynthesizer: no source → honest 'not found' (English default, Turkish when lang=tr)", async () => {
  const out = await new ExtractiveSynthesizer().synthesize("x", []);
  assert.equal(out.citations.length, 0);
  assert.match(out.answer, /No sourced content/); // default = English (main language)
  const tr = await new ExtractiveSynthesizer().synthesize("x", [], { lang: "tr" });
  assert.match(tr.answer, /bulunamadı/); // Turkish query → Turkish answer (multilingual)
});

test("scoreConfidence: kaynak artar/boşluk azalırsa yükselir; [0,1]", () => {
  const high = scoreConfidence({ cites: 3, gaps: 0, oldestDays: 0, topCosine: 0.5 });
  const low = scoreConfidence({ cites: 1, gaps: 5, oldestDays: 200, topCosine: null });
  assert.ok(high > low);
  assert.ok(high <= 1 && low >= 0);
  assert.equal(scoreConfidence({ cites: 0, gaps: 0, oldestDays: 0, topCosine: null }), 0);
});

function sampleResult(): ThinkResult {
  return {
    answer: "Rate-limit 500 rps [1]. Eski karar bayat [2].",
    citations: [
      { nodeId: "durable/decisions/0007", slug: "durable/decisions/0007", uri: "http://d7" },
      { nodeId: "durable/decisions/0003", slug: "durable/decisions/0003", uri: null },
    ],
    gaps: [{ kind: "stale", message: "0003 bayat", relatedNodeIds: ["durable/decisions/0003"] }],
    oldestSourceDays: 21,
    confidence: 0.66,
    mode: "business",
  };
}

test("buildSurface: tier öneki atılmış etiketler + kartlar", () => {
  const s = buildSurface("rate limit?", sampleResult());
  assert.equal(s.sources[0].label, "decisions/0007"); // durable/ atıldı
  assert.equal(s.sources[0].marker, 1);
  assert.deepEqual(s.cards, { sources: 2, openGaps: 1, oldestSourceDays: 21, confidence: 0.66 });
});

test("renderSurfaceText: mod, cevap, boşluk, kartlar içerir", () => {
  const txt = renderSurfaceText(buildSurface("q", sampleResult()));
  assert.match(txt, /business mode/);
  assert.match(txt, /SYNTHESIZED ANSWER/);
  assert.match(txt, /stale/); // gap kind label
  assert.match(txt, /confidence: 66%/);
});

test("renderSurfaceHtml: [n] → yeşil çip, boşluk kutusu, HTML kaçışı, güven %", () => {
  const r = sampleResult();
  r.answer = "Tehlike <script>x</script> [1]"; // kaçış testi
  const html = renderSurfaceHtml(buildSurface("q", r));
  assert.match(html, /class="src"/); // [1] çipe dönüştü
  assert.match(html, /decisions\/0007/); // etiket
  assert.ok(!html.includes("<script>x</script>"), "ham script kaçırılmalı");
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /66%/); // confidence card
  assert.match(html, /gapbox/); // sarı kutu
});
