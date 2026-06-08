// src/mcp/auth.ts
// MCP Resource Server auth (OAuth 2.1 + Resource Indicators / RFC 8707).
// Vitrus MCP HTTP server bir KAYNAK SUNUCUSUDUR: dış bir Authorization Server'ın
// verdiği Bearer token'ları DOĞRULAR (kendi token vermez).
//
// İlkeler (araştırma):
// - Resource Indicator: token'ın audience'ı (aud) BU kaynağa eşit olmalı (RFC 8707) —
//   başka kaynak için verilmiş token reddedilir (token yeniden kullanım saldırısına karşı).
// - Doğrulanan kimlik → expandPrincipals → ACL filtresine akar (fail-closed).
// - Kullanıcının MCP token'ı ASLA upstream API'lere geçirilmez (ayrı kimlik bilgisiyle erişilir).

import type { IncomingMessage } from "node:http";

export interface Identity {
  user: string; // principal (expandPrincipals'a verilir)
}

export interface TokenVerifier {
  /** Geçerli + bu kaynağa ait (aud) ise Identity; değilse null. */
  verify(token: string): Promise<Identity | null>;
}

/**
 * Dev/test doğrulayıcı: token → {user, aud}. aud bu kaynağa eşit değilse reddeder
 * (RFC 8707). Üretimde JWT doğrulayıcı (imza + iss + exp + aud) aynı arayüzden takılır.
 */
export class StaticTokenVerifier implements TokenVerifier {
  constructor(
    private readonly resource: string,
    private readonly tokens: Record<string, { user: string; aud: string }>
  ) {}
  async verify(token: string): Promise<Identity | null> {
    const t = this.tokens[token];
    if (!t) return null;
    if (t.aud !== this.resource) return null; // Resource Indicator: yanlış audience → reddet
    return { user: t.user };
  }
}

/** RFC 9728 Protected Resource Metadata (.well-known/oauth-protected-resource). */
export function protectedResourceMetadata(resource: string, authorizationServers: string[]) {
  return {
    resource,
    authorization_servers: authorizationServers,
    bearer_methods_supported: ["header"],
    scopes_supported: ["vitrus:read"],
  };
}

export function extractBearer(req: IncomingMessage): string | null {
  const h = req.headers["authorization"];
  if (typeof h === "string" && h.startsWith("Bearer ")) return h.slice(7).trim();
  return null;
}

/** Çevre değişkeninden dev verifier kur: VITRUS_AUTH_TOKENS="tok1:alice,tok2:bob". */
export function verifierFromEnv(resource: string, env: string | undefined): TokenVerifier | null {
  if (!env) return null;
  const tokens: Record<string, { user: string; aud: string }> = {};
  for (const pair of env.split(",")) {
    const [tok, user] = pair.split(":").map((s) => s.trim());
    if (tok && user) tokens[tok] = { user, aud: resource };
  }
  return Object.keys(tokens).length ? new StaticTokenVerifier(resource, tokens) : null;
}
