# ---- Build-Stufe: Abhängigkeiten installieren und Oberfläche bauen ----
FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY vite.config.js index.html admin.html ./
COPY public/ ./public/
COPY src/ ./src/
# lib/ wird auch vom Browser-Code importiert (Felder, Gewicht)
COPY lib/ ./lib/
RUN npm run build

# Nur Laufzeit-Abhängigkeiten behalten
RUN npm prune --omit=dev

# ---- Laufzeit-Stufe ----
FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3470

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json server.js ./
COPY lib/ ./lib/

# Die Anwendung speichert nichts im Dateisystem (alles liegt in der Datenbank) und läuft ohne Rechte
USER node

EXPOSE 3470

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3470/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
