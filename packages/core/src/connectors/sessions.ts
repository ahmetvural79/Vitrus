// src/connectors/sessions.ts
// Ajan oturum connector'ı (B1 — "The repo is not the memory"). Claude Code / Codex gibi
// ajanların .jsonl oturum transcript'lerini kayda çevirir: ARTEFAKT değil, MUHAKEME
// yakalanır (sparring, denenip budanmış dallar — repo'da kalmayan kısım).
//
// Varsayılan ACL = PRIVATE (oturum sahibi) — hassas veri; fail-closed zaten var.
// Varsayılan retentionDays (90) → B2 TTL süpürmesiyle eski oturumlar otomatik bayatlar.
//
// Girdi: tek .jsonl dosyası (bir oturum) VEYA dizin (*.jsonl, her biri bir oturum).
// Toleranslı satır ayrıştırma: {role,content} | {type,message:{role,content},timestamp}.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { Connector, SourceRecord } from "./types.js";
import type { AclEntry } from "../core/types.js";

interface Msg {
  role: string;
  content: string;
  ts: string | null;
}

function textOf(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c))
    return c
      .map((b) =>
        b && typeof b === "object" && "text" in b
          ? String((b as { text: unknown }).text ?? "")
          : typeof b === "string"
            ? b
            : ""
      )
      .join("");
  return "";
}

function parseLine(line: string): Msg | null {
  let o: Record<string, any>;
  try {
    o = JSON.parse(line) as Record<string, any>;
  } catch {
    return null;
  }
  const role = o.role ?? o.message?.role ?? o.type ?? "?";
  const content = textOf(o.content ?? o.message?.content).trim();
  if (!content) return null;
  const ts = o.timestamp ?? o.message?.timestamp ?? null;
  return { role: String(role), content, ts: ts ? String(ts) : null };
}

export interface SessionOpts {
  /** Oturum sahibi — PRIVATE ACL principal'i (zorunlu). */
  owner: string;
  /** Proje/rol kapsamı (B2 scope filtresi). */
  scope?: string;
  /** İçerik TTL (gün). Oturumlar hassas → varsayılan 90 gün sonra otomatik bayatlar. */
  retentionDays?: number;
}

export class SessionConnector implements Connector {
  readonly name = "sessions";
  readonly slugPrefix = "working/sessions/";
  constructor(
    private readonly path: string,
    private readonly opts: SessionOpts
  ) {}

  private files(): string[] {
    const st = statSync(this.path);
    if (st.isDirectory())
      return readdirSync(this.path)
        .filter((f) => f.endsWith(".jsonl"))
        .sort()
        .map((f) => join(this.path, f));
    return [this.path];
  }

  async fetch(): Promise<SourceRecord[]> {
    const acl: AclEntry[] = [{ kind: "user", principal: this.opts.owner }]; // PRIVATE varsayılan
    const retentionDays = this.opts.retentionDays ?? 90;
    const records: SourceRecord[] = [];
    for (const file of this.files()) {
      const msgs = readFileSync(file, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map(parseLine)
        .filter((m): m is Msg => m !== null);
      if (msgs.length === 0) continue;

      const id = basename(file).replace(/\.jsonl$/, "");
      const firstUser = msgs.find((m) => m.role === "user") ?? msgs[0];
      const title = firstUser.content.replace(/\s+/g, " ").slice(0, 60);
      const content = msgs.map((m) => `${m.role}: ${m.content}`).join("\n\n");
      const capturedAt = msgs.find((m) => m.ts)?.ts ?? null;

      records.push({
        sourceId: id,
        type: "session",
        tier: "working",
        title,
        content,
        uri: null,
        capturedAt,
        acl,
        slug: `working/sessions/${id}`,
        scope: this.opts.scope,
        retentionDays,
      });
    }
    return records;
  }
}
