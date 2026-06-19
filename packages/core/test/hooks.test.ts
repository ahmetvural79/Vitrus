import { test } from "node:test";
import assert from "node:assert/strict";
import { hooksFor, disciplineText, type AgentKind } from "../src/cli/hooks.js";

// `vitrus hooks install` jeneratörleri — saf fonksiyon testi (dosya yazımı yok).

test("hooksFor(claude): .mcp.json + .claude/settings.json + VITRUS.md üretir", () => {
  const files = hooksFor("claude", { brainDir: "./brain", dataDir: "./.vitrus" });
  const paths = files.map((f) => f.path).sort();
  assert.deepEqual(paths, [".claude/settings.json", ".mcp.json", "VITRUS.md"]);

  const mcp = files.find((f) => f.path === ".mcp.json")!;
  const parsed = JSON.parse(mcp.content);
  assert.equal(parsed.mcpServers.vitrus.command, "vitrus");
  assert.deepEqual(parsed.mcpServers.vitrus.args, ["mcp"]);
  assert.equal(parsed.mcpServers.vitrus.env.VITRUS_BRAIN, "./brain");

  const settings = JSON.parse(files.find((f) => f.path === ".claude/settings.json")!.content);
  assert.ok(settings.hooks.SessionStart, "read-before-act: SessionStart hook olmalı");
  assert.ok(settings.hooks.Stop, "write-after-decide: Stop hook olmalı");
});

test("hooksFor(cursor): .cursor/mcp.json + alwaysApply kural dosyası", () => {
  const files = hooksFor("cursor");
  const paths = files.map((f) => f.path).sort();
  assert.deepEqual(paths, [".cursor/mcp.json", ".cursor/rules/vitrus.mdc"]);
  const rule = files.find((f) => f.path === ".cursor/rules/vitrus.mdc")!;
  assert.match(rule.content, /alwaysApply: true/);
  // mcp.json varsayılan brain/data ile geçerli JSON.
  const mcp = JSON.parse(files.find((f) => f.path === ".cursor/mcp.json")!.content);
  assert.equal(mcp.mcpServers.vitrus.env.VITRUS_DATA, "./.vitrus");
});

test("hooksFor(codex): config.toml parçası + AGENTS.md", () => {
  const files = hooksFor("codex", { brainDir: "/srv/brain" });
  const paths = files.map((f) => f.path).sort();
  assert.deepEqual(paths, ["AGENTS.md", "vitrus.codex.toml"]);
  const toml = files.find((f) => f.path === "vitrus.codex.toml")!;
  assert.match(toml.content, /\[mcp_servers\.vitrus\]/);
  assert.match(toml.content, /VITRUS_BRAIN = "\/srv\/brain"/);
});

test("disciplineText: read-before + write-after disiplinini ve araçları içerir", () => {
  const t = disciplineText();
  assert.match(t, /Read before you act/);
  assert.match(t, /Write after you decide/);
  assert.match(t, /record_decision/);
  assert.match(t, /capture_session/);
});

test("hooksFor: tüm ajanlar için her dosya boş olmayan içerik üretir", () => {
  for (const agent of ["claude", "cursor", "codex"] as AgentKind[]) {
    for (const f of hooksFor(agent)) {
      assert.ok(f.content.trim().length > 0, `${agent}:${f.path} boş olmamalı`);
    }
  }
});
