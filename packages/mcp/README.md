# @vitrus/mcp

Vitrus'i **Model Context Protocol (MCP)** üzerinden sunan ince sunucu paketi — Claude Code, Cursor ve
diğer ajanlar Vitrus beynini okur/yazar. Tüm mantık [`@vitrus/core`](../core)'da; bu paket sadece bin sarmalayıcı.

```bash
bunx @vitrus/mcp                 # stdio (Claude Code/Cursor bunu çağırır)
bunx @vitrus/mcp --http 3000     # Streamable HTTP :3000/mcp (OAuth opsiyonel)
```

Claude Code'a ekleme:
```bash
claude mcp add vitrus -- bunx @vitrus/mcp
```

Veri dizini `VITRUS_DATA` (varsayılan `./.vitrus`); önce `vitrus import <dir>`. Embedder/synthesizer/
reranker ve backend (PGLite/Postgres) sağlayıcıları ortam değişkenlerinden seçilir — bkz. `@vitrus/core`.

Apache-2.0. Açık çekirdeğin parçası.
