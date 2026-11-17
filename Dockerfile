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

# ---- Go-Stufe: Programm zum Bau der Karte (daten-bauen karte <pbf> <netz>) ----
FROM golang:1.22-bookworm AS karte
WORKDIR /src
COPY daten-bauen/ ./
RUN CGO_ENABLED=0 go build -trimpath -o /out/daten-bauen .

# ---- Laufzeit-Stufe ----
FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3470

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json server.js ./
COPY lib/ ./lib/
# Werkzeuge für Kartenbau und Netzbau (vom Garage-Worker gestartet)
COPY tools/routing/ ./tools/routing/
# Karte bauen (vom Worker gestartet, siehe lib/worker.js)
COPY --from=karte /out/daten-bauen /app/bin/daten-bauen

# Die Anwendung speichert Fotos im Ordner fotos (als Volume eingebunden); sonst liegt alles in der Datenbank. Sie läuft ohne Rechte
RUN mkdir -p /app/fotos /app/kacheln && chown node:node /app/fotos /app/kacheln
USER node

EXPOSE 3470

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3470/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
