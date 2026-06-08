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
