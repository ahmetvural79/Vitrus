#!/usr/bin/env bun
// @vitrus/mcp — Vitrus MCP sunucusu (ince sarmalayıcı).
// @vitrus/core'un MCP girişini çalıştırır; tüm mantık core'da (tek motor sözleşmesi).
//   stdio:  vitrus-mcp
//   http:   vitrus-mcp --http 3000
// Ortam: VITRUS_DATA (veri dizini), embedder/synth/reranker/backend sağlayıcıları env'den.
import "@vitrus/core/mcp";
