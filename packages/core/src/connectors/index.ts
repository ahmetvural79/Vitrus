// src/connectors/index.ts — connector framework barrel (cloud-api + dış tüketiciler için).
// @vitrus/core/connectors → adaptör arayüzü + ingest (incremental + prune + ACL/grup capture) + connectorlar.
export * from "./types.js"; // Connector, SourceRecord, recordToNode
export { ingest, type IngestResult } from "./ingest.js";
export { SlackConnector } from "./slack.js";
export { GitHubConnector } from "./github.js";
export { DocsConnector } from "./docs.js";
export { SessionConnector } from "./sessions.js";
export { EmailConnector } from "./email.js";
export { CalendarConnector } from "./calendar.js";
export { ChangeQueue, parseWebhook } from "./webhook.js";
export { RestConnector, type RestConfig, type RestFetch } from "./rest.js"; // M1 Faz A: generic REST
export { CONNECTOR_PRESETS, presetToConfig, type ConnectorPreset } from "./presets.js"; // 8 REST preset (Stripe/HubSpot/…)
export { InboxConnector, captureRecord, type CaptureOpts } from "./inbox.js"; // M3.5: capture/inbox
