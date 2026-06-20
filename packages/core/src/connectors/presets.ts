// src/connectors/presets.ts
// 8 önceden-tanımlı REST connector preset'i (Stripe/HubSpot/Salesforce/Asana/Teams/Dropbox/Figma/Zoom).
// Her preset bir RestConfig iskeletidir (token HARİÇ — runtime'da vault'tan enjekte edilir). Böylece
// kullanıcı API URL'ini/şeklini bilmeden connector'ı seçip token girer → generic RestConnector çalışır.
// "Altyapı hazır, token girilince aktif." v1: her connector birincil bir nesne tipini ingest eder
// (config'teki `url`/`params`/`body` override edilerek genişletilebilir — şemasız, Image #1 motoru).
import type { RestConfig } from "./rest.js";
import type { NodeType } from "../core/types.js";

export interface ConnectorPreset {
  label: string;
  /** Birincil liste endpoint'i (tam URL). Kullanıcı override edebilir (ör. Salesforce instance URL'i). */
  url: string;
  method?: RestConfig["method"];
  body?: unknown;
  itemsPath?: string;
  idField?: string;
  titleField?: string;
  uriField?: string;
  type: NodeType;
  slugPrefix: string;
  /** Auth şekli — token BURADA YOK, runtime'da vault'tan gelir. */
  auth: { type: "bearer" | "header"; header?: string };
  /** Dashboard ipucu: token nasıl alınır. */
  tokenLabel: string;
  /** Birincil olarak neyi ingest eder (şeffaflık). */
  ingests: string;
}

export const CONNECTOR_PRESETS: Record<string, ConnectorPreset> = {
  stripe: {
    label: "Stripe", url: "https://api.stripe.com/v1/customers?limit=100", itemsPath: "data",
    idField: "id", titleField: "email", type: "document", slugPrefix: "working/stripe/",
    auth: { type: "bearer" }, tokenLabel: "Stripe secret key (sk_live_… / sk_test_…)", ingests: "customers",
  },
  hubspot: {
    label: "HubSpot", url: "https://api.hubapi.com/crm/v3/objects/contacts?limit=100&properties=email,firstname,lastname,company",
    itemsPath: "results", idField: "id", titleField: "properties.email", type: "document", slugPrefix: "working/hubspot/",
    auth: { type: "bearer" }, tokenLabel: "HubSpot private-app token", ingests: "contacts",
  },
  salesforce: {
    label: "Salesforce", url: "https://login.salesforce.com/services/data/v60.0/sobjects/Account/listviews",
    itemsPath: "listviews", idField: "id", titleField: "label", type: "document", slugPrefix: "working/salesforce/",
    auth: { type: "bearer" }, tokenLabel: "Salesforce OAuth token (set your instance URL in the URL field)", ingests: "account list views",
  },
  asana: {
    label: "Asana", url: "https://app.asana.com/api/1.0/workspaces", itemsPath: "data",
    idField: "gid", titleField: "name", type: "note", slugPrefix: "working/asana/",
    auth: { type: "bearer" }, tokenLabel: "Asana personal access token", ingests: "workspaces",
  },
  teams: {
    label: "Microsoft Teams", url: "https://graph.microsoft.com/v1.0/me/joinedTeams", itemsPath: "value",
    idField: "id", titleField: "displayName", type: "document", slugPrefix: "working/teams/",
    auth: { type: "bearer" }, tokenLabel: "Microsoft Graph OAuth token (Team.ReadBasic.All)", ingests: "joined teams",
  },
  dropbox: {
    label: "Dropbox", url: "https://api.dropboxapi.com/2/files/list_folder", method: "POST",
    body: { path: "", recursive: false, limit: 200 }, itemsPath: "entries", idField: "id", titleField: "name",
    type: "document", slugPrefix: "working/dropbox/", auth: { type: "bearer" },
    tokenLabel: "Dropbox OAuth access token (files.metadata.read)", ingests: "files & folders",
  },
  figma: {
    label: "Figma", url: "https://api.figma.com/v1/me", itemsPath: "", idField: "id", titleField: "email",
    type: "document", slugPrefix: "working/figma/", auth: { type: "header", header: "x-figma-token" },
    tokenLabel: "Figma personal access token", ingests: "account (extend with /files/<key> in the URL field)",
  },
  zoom: {
    label: "Zoom", url: "https://api.zoom.us/v2/users/me/meetings", itemsPath: "meetings",
    idField: "id", titleField: "topic", type: "meeting", slugPrefix: "working/zoom/",
    auth: { type: "bearer" }, tokenLabel: "Zoom OAuth access token (meeting:read)", ingests: "meetings",
  },
};

/** Preset → RestConfig (token HARİÇ). Factory bunu vault token + saklı override'larla birleştirir. */
export function presetToConfig(name: string, preset: ConnectorPreset): RestConfig {
  return {
    name,
    url: preset.url,
    method: preset.method,
    body: preset.body,
    itemsPath: preset.itemsPath,
    idField: preset.idField,
    titleField: preset.titleField,
    uriField: preset.uriField,
    type: preset.type,
    slugPrefix: preset.slugPrefix,
  };
}
