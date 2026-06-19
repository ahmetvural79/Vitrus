// src/cli/hooks.ts
// `vitrus hooks install` jeneratörleri — ajan entegrasyon dosyalarını ÜRETİR (saf fonksiyon,
// test edilebilir; dosya yazımı CLI'da). "Write-after-decide" döngüsünü MEKANİK yapar
// (brainincorp tezi: hafıza aspirasyonel değil, altyapıdır).
//
// İki disiplin, üç ajan:
//   - READ BEFORE YOU ACT  → SessionStart bağlamı (mevcut boşluklar enjekte) + kural metni.
//   - WRITE AFTER YOU DECIDE → record_decision/capture_session + Stop reminder hook'u.
//
// MCP bağlantısı: ajan "vitrus" MCP sunucusuna bağlanır (search/think/gap_report/verify +
// remember/record_decision/capture_session). VITRUS_BRAIN → yazımlar markdown'a kalıcı (sahiplik).

export type AgentKind = "claude" | "cursor" | "codex";

export interface HookFile {
  /** Hedef dizine göreli yol. */
  path: string;
  /** Dosya içeriği. */
  content: string;
}

export interface HooksOpts {
  /** Markdown kaynağı (ajan yazımları buraya kalıcılaşır). Varsayılan "./brain". */
  brainDir?: string;
  /** Türev indeks dizini. Varsayılan "./.vitrus". */
  dataDir?: string;
}

/** Ajandan-bağımsız disiplin metni (READ BEFORE / WRITE AFTER). */
export function disciplineText(): string {
  return [
    "## Vitrus — company brain discipline",
    "",
    'This project has a Vitrus company brain, exposed as the MCP server `vitrus`',
    "(tools: `search`, `think`, `gap_report`, `verify`, `provenance`,",
    "`remember`, `record_decision`, `capture_session`).",
    "",
    "**Read before you act.** Before starting a task, query the brain: use `search` /",
    "`think` to recall prior decisions and context, and check `gap_report` for what the",
    "brain does NOT yet know. Do not re-derive what the brain already records.",
    "",
    "**Write after you decide.** When you make a decision, persist it with",
    "`record_decision` (decision + rationale + sources; pass `supersedes` to retire an old",
    "decision, `contradicts` to flag a conflict — Vitrus tells you back if it conflicts).",
    "At the end of a working session, capture your reasoning with `capture_session`.",
    "The brain stays live only if you write back to it.",
    "",
  ].join("\n");
}

function mcpJson(opts: HooksOpts): string {
  const obj = {
    mcpServers: {
      vitrus: {
        command: "vitrus",
        args: ["mcp"],
        env: { VITRUS_BRAIN: opts.brainDir ?? "./brain", VITRUS_DATA: opts.dataDir ?? "./.vitrus" },
      },
    },
  };
  return JSON.stringify(obj, null, 2) + "\n";
}

/** Claude Code: .mcp.json + .claude/settings.json (SessionStart bağlam + Stop reminder) + CLAUDE bölümü. */
function claudeFiles(opts: HooksOpts): HookFile[] {
  // SessionStart: `vitrus gaps` çıktısı bağlama eklenir (READ BEFORE — beyin neyi bilmiyor).
  // Stop: kararları kalıcılaştırma reminder'ı (WRITE AFTER — bloklamaz, sadece hatırlatır).
  const settings = {
    hooks: {
      SessionStart: [
        { hooks: [{ type: "command", command: "vitrus gaps || true" }] },
      ],
      Stop: [
        {
          hooks: [
            {
              type: "command",
              command:
                "echo 'Vitrus reminder: if you made a decision, persist it with record_decision; capture reasoning with capture_session.'",
            },
          ],
        },
      ],
    },
  };
  return [
    { path: ".mcp.json", content: mcpJson(opts) },
    { path: ".claude/settings.json", content: JSON.stringify(settings, null, 2) + "\n" },
    { path: "VITRUS.md", content: disciplineText() },
  ];
}

/** Cursor: .cursor/mcp.json + .cursor/rules/vitrus.mdc (alwaysApply). */
function cursorFiles(opts: HooksOpts): HookFile[] {
  const rule = ["---", "alwaysApply: true", "---", "", disciplineText()].join("\n");
  return [
    { path: ".cursor/mcp.json", content: mcpJson(opts) },
    { path: ".cursor/rules/vitrus.mdc", content: rule },
  ];
}

/** Codex: config.toml parçası (~/.codex/config.toml'a eklenir) + AGENTS bölümü. */
function codexFiles(opts: HooksOpts): HookFile[] {
  const toml = [
    "# ~/.codex/config.toml içine ekleyin:",
    "[mcp_servers.vitrus]",
    'command = "vitrus"',
    'args = ["mcp"]',
    "",
    "[mcp_servers.vitrus.env]",
    `VITRUS_BRAIN = "${opts.brainDir ?? "./brain"}"`,
    `VITRUS_DATA = "${opts.dataDir ?? "./.vitrus"}"`,
    "",
  ].join("\n");
  return [
    { path: "vitrus.codex.toml", content: toml },
    { path: "AGENTS.md", content: disciplineText() },
  ];
}

/** Bir ajan için üretilecek entegrasyon dosyaları (saf — dosya yazmaz). */
export function hooksFor(agent: AgentKind, opts: HooksOpts = {}): HookFile[] {
  switch (agent) {
    case "claude":
      return claudeFiles(opts);
    case "cursor":
      return cursorFiles(opts);
    case "codex":
      return codexFiles(opts);
  }
}
