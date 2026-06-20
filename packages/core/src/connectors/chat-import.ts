// src/connectors/chat-import.ts
// ChatGPT + Claude sohbet EXPORT'unu (conversations.json) Vitrus düğümlerine alır. Her konuşma → bir
// "note" düğümü (rol: metin biçiminde transcript). İki şekli de tanır:
//   ChatGPT: { title, mapping: { <id>: { message: { author:{role}, content:{parts:[...]}, create_time } } } }
//   Claude : { name|uuid, chat_messages: [ { sender, text } ] }
// Deterministik (enjekte JSON + dışarıdan `now`), şemasız, LLM yok.
import type { Connector, SourceRecord } from "./types.js";
import { PUBLIC_PRINCIPAL } from "../core/types.js";

type Json = Record<string, unknown>;

function slugify(s: string): string {
  return s.trim().replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 60) || "chat";
}

function extractChatGPT(conv: Json): { title: string; id: string; lines: string[] } | null {
  const mapping = conv.mapping as Record<string, Json> | undefined;
  if (!mapping || typeof mapping !== "object") return null;
  const msgs: { t: number; role: string; text: string }[] = [];
  for (const node of Object.values(mapping)) {
    const m = node?.message as Json | undefined;
    if (!m) continue;
    const role = ((m.author as Json)?.role as string) ?? "?";
    const parts = ((m.content as Json)?.parts as unknown[]) ?? [];
    const text = parts.filter((p): p is string => typeof p === "string").join("\n").trim();
    if (!text) continue;
    msgs.push({ t: (m.create_time as number) ?? 0, role, text });
  }
  if (msgs.length === 0) return null;
  msgs.sort((a, b) => a.t - b.t);
  return {
    title: (conv.title as string) || "ChatGPT conversation",
    id: String(conv.id ?? conv.conversation_id ?? slugify((conv.title as string) ?? "")),
    lines: msgs.map((m) => `**${m.role}:** ${m.text}`),
  };
}

function extractClaude(conv: Json): { title: string; id: string; lines: string[] } | null {
  const msgs = conv.chat_messages as Json[] | undefined;
  if (!Array.isArray(msgs)) return null;
  const lines = msgs
    .map((m) => `**${(m.sender as string) ?? "?"}:** ${String(m.text ?? "").trim()}`)
    .filter((l) => l.length > 12);
  if (lines.length === 0) return null;
  return { title: (conv.name as string) || "Claude conversation", id: String(conv.uuid ?? slugify((conv.name as string) ?? "")), lines };
}

/** ChatGPT/Claude conversations array → SourceRecord[] (her konuşma = bir note). */
export function chatExportToRecords(conversations: unknown, opts: { now: string; slugPrefix?: string }): SourceRecord[] {
  const arr = Array.isArray(conversations) ? conversations : [];
  const prefix = opts.slugPrefix ?? "working/chat/";
  const recs: SourceRecord[] = [];
  for (const c of arr) {
    const ext = extractChatGPT(c as Json) ?? extractClaude(c as Json);
    if (!ext) continue;
    recs.push({
      sourceId: ext.id,
      type: "note",
      tier: "working",
      title: ext.title.slice(0, 120),
      content: ext.lines.join("\n\n"),
      uri: null,
      capturedAt: opts.now,
      acl: [{ kind: "public", principal: PUBLIC_PRINCIPAL }],
      slug: prefix + slugify(ext.title) + "-" + slugify(ext.id).slice(0, 8),
    });
  }
  return recs;
}

export class ChatImportConnector implements Connector {
  readonly name = "chat-import";
  readonly slugPrefix: string;
  constructor(
    private conversations: unknown,
    private opts: { now: string; slugPrefix?: string }
  ) {
    this.slugPrefix = opts.slugPrefix ?? "working/chat/";
  }
  async fetch(): Promise<SourceRecord[]> {
    return chatExportToRecords(this.conversations, { now: this.opts.now, slugPrefix: this.slugPrefix });
  }
}
