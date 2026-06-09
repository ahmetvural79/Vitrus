# MCP — agent-native access

Vitrus ships an [MCP](https://modelcontextprotocol.io) server so any agent (Claude Code, Cursor, your
own) queries the **same brain** you use from the CLI. No separate index, no drift.

## Run it

```bash
vitrus mcp                 # stdio (default) — for local agents
vitrus mcp --http 3000     # Streamable HTTP — for remote agents
# or: bun run mcp [-- --http 3000]
```

## Wire into a client

```bash
claude mcp add vitrus -- bunx @vitrus/mcp           # Claude Code
```

```jsonc
// Cursor / generic MCP config
{
  "mcpServers": {
    "vitrus": { "command": "bunx", "args": ["@vitrus/mcp"] }
  }
}
```

## Tools the agent gets

| Tool | Purpose |
| --- | --- |
| `search` | Hybrid retrieval (vector + BM25 + entity → RRF). Ranked nodes. |
| `think` | Synthesized answer + citations + **gap box** + confidence. |
| `gap_report` | Deterministic "what the brain doesn't know" for a topic. |
| `provenance` | Trace a node back to its source(s). |
| `get_node` | Fetch a node by id/slug with its chunks and edges. |
| `verify` | Grounded / stale / contradicted / unsupported verdict for a claim. |

Because `gap_report` and `verify` are deterministic, an agent can *trust the boundaries*: it knows when
to act and when to say "we don't have that documented" instead of hallucinating.

## Transports

- **stdio** — the default; the client spawns the process and talks over stdin/stdout.
- **Streamable HTTP** — `--http <port>`; for remote/shared servers. The commercial cloud layer adds
  OAuth 2.1 (the server acts as a resource server); the open core HTTP transport is unauthenticated and
  meant to sit behind your own auth.

## Skill packs

`vitrus skill` exports a `SKILL.md` (open Agent Skills format) so a brain can be packaged as a
reusable, evaluable skill. `vitrus skill-eval <name>` re-runs its frozen eval against the live brain —
"if it forgets, it's a test failure."

See [ARCHITECTURE.md](./ARCHITECTURE.md) for how retrieval and gaps work under these tools.
