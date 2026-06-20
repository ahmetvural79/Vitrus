// src/connectors/inbox.ts
// "Inbox" yakalama (gbrain capture/inbox-folder paritesi):
//  • captureRecord — tek-komut ad-hoc not (vitrus capture "<text>" | --file | stdin).
//  • InboxConnector — izlenen drop klasörü (vitrus ingest inbox <dir>): "mobil uygulama olmadan
//    mobil yakalama" — iOS Shortcuts/iCloud/AirDrop bir klasöre dosya bırakır → beyne girer.
// Hepsi working/inbox/ namespace'inde, type=note. Deterministik: slug = tarih + içerik-hash / dosya adı.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { createHash } from "node:crypto";
import type { Connector, SourceRecord } from "./types.js";
import { PUBLIC_PRINCIPAL, type AclEntry } from "../core/types.js";

// Ayrı namespace'ler: capture (ad-hoc CLI notu) ile inbox-folder (drop klasör) ÇAKIŞMAMALI —
// aksi halde `ingest inbox` budaması capture notlarını siler. capture asla otomatik budanmaz.
const CAPTURE_PREFIX = "working/captures/";
const INBOX_PREFIX = "working/inbox/";
const TEXT_EXT = new Set([".md", ".txt", ".markdown", ".text", ""]); // "" = uzantısız düz metin

function sha8(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 8);
}
/** İlk anlamlı satırdan başlık türet (markdown başlık işaretini soy), yoksa fallback. */
function titleFrom(text: string, fallback: string): string {
  const first = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return (first ? first.replace(/^#+\s*/, "") : fallback).slice(0, 80);
}
/** owner verilirse PRIVATE (sahip); yoksa PUBLIC (org-geneli). */
function aclFor(owner?: string): AclEntry[] {
  return owner ? [{ kind: "user", principal: owner }] : [{ kind: "public", principal: PUBLIC_PRINCIPAL }];
}

export interface CaptureOpts {
  /** ISO yakalama zamanı — deterministik slug için DIŞARIDAN verilir (core'da Date.now yok). */
  now: string;
  title?: string;
  /** Verilirse private (sahip) ACL; yoksa public. */
  owner?: string;
  scope?: string;
}

/** Tek ad-hoc not → SourceRecord. slug = working/inbox/<YYYY-MM-DD>-<sha8(içerik)>. */
export function captureRecord(text: string, opts: CaptureOpts): SourceRecord {
  const body = text.trim();
  const id = `${opts.now.slice(0, 10)}-${sha8(body)}`;
  return {
    sourceId: id,
    type: "note",
    tier: "working",
    title: opts.title ?? titleFrom(body, id),
    content: body,
    uri: null,
    capturedAt: opts.now,
    acl: aclFor(opts.owner),
    slug: `${CAPTURE_PREFIX}${id}`,
    scope: opts.scope,
  };
}

export interface InboxOpts {
  owner?: string;
  scope?: string;
}

/** İzlenen drop klasörü → her metin dosyası bir working/inbox/ notu. Deterministik (dosya adı/hash). */
export class InboxConnector implements Connector {
  readonly name = "inbox";
  readonly slugPrefix = INBOX_PREFIX;
  constructor(
    private dir: string,
    private opts: InboxOpts = {}
  ) {}

  async fetch(): Promise<SourceRecord[]> {
    let names: string[];
    try {
      names = readdirSync(this.dir)
        .filter((f) => !f.startsWith(".") && TEXT_EXT.has(extname(f).toLowerCase()))
        .sort();
    } catch {
      throw new Error(`InboxConnector: klasör okunamadı: ${this.dir}`);
    }
    const acl = aclFor(this.opts.owner);
    const out: SourceRecord[] = [];
    for (const name of names) {
      const full = join(this.dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      const content = readFileSync(full, "utf8").trim();
      if (!content) continue;
      const stem = basename(name, extname(name)) || sha8(content);
      out.push({
        sourceId: stem,
        type: "note",
        tier: "working",
        title: titleFrom(content, stem),
        content,
        uri: null,
        capturedAt: st.mtime.toISOString(),
        acl,
        slug: `${INBOX_PREFIX}${stem}`,
        scope: this.opts.scope,
      });
    }
    return out;
  }
}
