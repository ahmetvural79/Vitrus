# Vitrus MCP server — self-host. Air-gapped: dış servis çağrısı yok
# (PGLite + yerel embedder). Üretimde OpenAI/Ollama embedder env ile takılır.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production VITRUS_DATA=/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
VOLUME /data
EXPOSE 3000
# Streamable HTTP; OAuth için VITRUS_AUTH_TOKENS ver. stdio için CMD'yi değiştir.
CMD ["node", "dist/mcp/index.js", "--http", "3000"]
