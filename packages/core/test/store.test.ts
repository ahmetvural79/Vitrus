import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { MarkdownStore } from "../src/store/markdown-store.js";

const here = dirname(fileURLToPath(import.meta.url));
const brainDir = join(here, "..", "brain");

test("örnek beyni okur: düğümler, kenarlar + ACL + provenance", () => {
  const store = new MarkdownStore(brainDir);
  const files = store.listFiles();
  assert.equal(files.length, 14);

  const incident = store.readAll().find((n) => n.node.type === "incident");
  assert.ok(incident, "incident düğümü bulunmalı");
  // caused_by + resolved_by açık tipli kenarlar + mentions (servis/ekip)
  const types = incident!.edges.map((e) => e.type).sort();
  assert.ok(types.includes("caused_by"));
  assert.ok(types.includes("resolved_by"));
  // ACL toplandı (uygulanmaz — Faz 1)
  assert.deepEqual(incident!.node.acl, [
    { kind: "group", principal: "eng" },
    { kind: "group", principal: "oncall" },
  ]);
  // provenance
  assert.equal(incident!.node.provenance.connector, "slack");
});

test("sidecar round-trip + rebuild deterministik (kaynak-üstü graf)", () => {
  const dir = mkdtempSync(join(tmpdir(), "vitrus-"));
  try {
    mkdirSync(join(dir, "durable"), { recursive: true });
    writeFileSync(
      join(dir, "durable", "x.md"),
      "---\ntype: note\n---\n# X\n[[owns::durable/y]] ve [[durable/z]]"
    );
    const store = new MarkdownStore(dir);

    const { edges } = store.readNode("durable/x.md");
    store.writeSidecar("durable/x.md", edges);
    assert.deepEqual(store.readSidecar("durable/x.md"), edges);

    // rebuild iki kez → birebir aynı (determinist; indeks atılabilir invariantı tadı)
    store.rebuildSidecars();
    const first = readFileSync(join(dir, "durable", "x.edges.json"), "utf8");
    store.rebuildSidecars();
    const second = readFileSync(join(dir, "durable", "x.edges.json"), "utf8");
    assert.equal(first, second);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
