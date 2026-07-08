# @vitrus/whatsapp — WhatsApp agent for your company brain (Phase 0 spike)

Add a Vitrus agent to your **WhatsApp project groups**. It quietly pipes the group's
messages into your Vitrus brain, and answers questions **in the chat** when you address it
(`vitrus …`). The same conversations become queryable from the Vitrus dashboard too.

**It captures more than text.** Shared **images** are described + OCR'd, and **voice notes**
are transcribed — both become searchable knowledge alongside the messages, so "what did the
photo of the delivery note say?" or "what did Ayşe's voice message decide?" just work. The
AI media processing runs **server-side** (Vitrus cloud-api); the bridge only forwards the raw
bytes, so the sidecar itself stays key-less.

> **Status: Phase 0 spike.** The pure core (message → `SourceRecord`, addressing, opt-out,
> answer formatting) is implemented and unit-tested. Going live needs you to link a real
> WhatsApp number by scanning a QR — only you can do that.

## ⚠️ Read this first (honest constraints)

- **Official Meta WhatsApp API cannot join existing groups** (its Groups API is create-only,
  ≤8 people). The **only** way to sit inside a real project group is an unofficial
  **linked-device** client — here, [Baileys](https://github.com/WhiskeySockets/Baileys).
- That is a **WhatsApp ToS gray area with a real, permanent ban risk.** Mitigations built in:
  the agent is **read-mostly** (never speaks unless addressed — the lowest-risk profile),
  humanized reply delays, and a per-group **opt-out** (`/vitrus off`).
- **Use a burner number you own**, never a personal/primary number, and never make the
  ingestion number load-bearing for anything else. Expect to hot-swap it eventually.
- **KVKK/GDPR:** ingesting a whole group touches every member's messages. For anything beyond
  a personal test, the bot must be a **disclosed participant** with consent + retention limits
  (`VITRUS_WA_RETENTION`) — and self-host so the data stays yours.

## Architecture

```
WhatsApp group ──Baileys(linked-device, Node)──▶ record.ts (pure)  ──▶ IngestClient
                                                  msg → SourceRecord     ├─ file  (Phase 0: capture to JSONL)
   "vitrus …"  ◀──────reply(answer+sources+gap)────  ask()               └─ HTTP  (Phase 2: cloud-api webhook)
```

- `src/record.ts` — **pure, Baileys-free, tested.** WhatsApp group message → Vitrus
  `SourceRecord` (`working/whatsapp-group/<groupId>/<msgId>`, per-group ACL, KVKK TTL),
  plus addressing/opt-out/answer-format helpers.
- `src/ingest.ts` — `FileIngestClient` (Phase 0 capture) and `HttpIngestClient` (Phase 2, posts
  to cloud-api). The bridge runs on **Node**, the brain on **Bun**, so they talk over
  HTTP/file — no runtime coupling; only the `SourceRecord` *type* is shared.
- `src/agent.ts` — Baileys wiring: link via QR, listen to group messages, ingest, and reply
  only when addressed. Images and voice notes are downloaded and forwarded as base64 for
  server-side AI description/transcription (media never triggers a reply — ingest only).

## Run (Phase 0)

```bash
cd packages/whatsapp
npm install                      # baileys + qrcode-terminal + pino
npm start                        # = node --import tsx src/index.ts
# → scan the QR on a BURNER WhatsApp: Settings → Linked devices → Link a device
# → add that number to a test group, chat, and watch ./captured/messages.jsonl fill up
# → in the group, type:  vitrus what did we decide?   (Phase 0 replies with a stub)
```

Wire it to a live brain (Phase 2 — the cloud-api endpoint now exists):

```bash
# single org-scoped endpoint; the bridge sends {op:"ingest"|"ask"} to the same URL
export VITRUS_INGEST_URL=https://api.vitrus.dev/t/<org>/whatsapp-group
export VITRUS_API_TOKEN=…        # org bearer token (dashboard → Connect agent)
# VITRUS_THINK_URL is optional — defaults to VITRUS_INGEST_URL
npm start
```

Server contract (`POST /t/<org>/whatsapp-group`, `Authorization: Bearer <org token>`):
- `{op:"ingest", records:[SourceRecord], images:[…], audios:[…]}` → `putNode` into the org
  brain (writer role required). `images[]` are AI-described + OCR'd; `audios[]` are AI-transcribed
  — both server-side — then stored as searchable nodes with the same per-group ACL + TTL.
- `{op:"ask", question, groupJid}` → `{answer, sources, gap}`; **fail-closed** principals
  (`PUBLIC` + `whatsapp-group:<gid>`, widen via `connector_config`).

### Env

| var | default | meaning |
|---|---|---|
| `VITRUS_WA_AUTH_DIR` | `./.wa-auth` | Baileys session dir (linked-device state) |
| `VITRUS_WA_TRIGGER` | `vitrus` | word that addresses the bot |
| `VITRUS_WA_GROUPS` | *(all)* | comma-separated allowed group ids (local part of the JID) |
| `VITRUS_WA_RETENTION` | *(none)* | KVKK TTL in days → `expiresAt` on captured nodes |
| `VITRUS_INGEST_URL` | *(unset → file capture)* | cloud-api endpoint `…/t/<org>/whatsapp-group` |
| `VITRUS_THINK_URL` | *(unset → same as ingest)* | override Q&A endpoint (usually leave unset) |
| `VITRUS_CAPTURE_FILE` | `./captured/messages.jsonl` | file-capture path (Phase 0) |

### In-group controls

- `vitrus <question>` — ask the brain (read-mostly: this is the only thing that triggers a reply).
- `/vitrus off` — stop capturing this group (consent/opt-out). `/vitrus on` — resume.

## Test

```bash
npm test        # node --test --import tsx "test/**/*.test.ts"  (pure core; no WhatsApp needed)
```

## Status by phase

- **Phase 0 (done):** pure core (`record.ts`) + Baileys agent + file/HTTP ingest client, unit-tested.
- **Phase 2 (server done):** cloud-api `POST /t/<org>/whatsapp-group` (`op=ingest|ask`) with
  org bearer auth + fail-closed group principals, plus server-side **image description/OCR** and
  **voice-note transcription** — implemented, unit-tested, and live. Dashboard has a WhatsApp
  Groups connector card (principals/retention). **Pending:** in-dashboard QR-link flow.
- **Phase 3:** disclosed bot identity + in-group notice, PII masking (enterprise), number
  hot-swap & ban alerting, optional managed provider (Whapi/GreenAPI).
- **Phase 4:** proactive `vitrus watch` over the group corpus (stale commitments, open questions).
