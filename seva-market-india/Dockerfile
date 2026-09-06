# SEVA MARKET INDIA — production image (durable data on a mounted volume)
#
# Zero runtime npm dependencies (uses the built-in node:sqlite), so no install
# step is needed. The SQLite database lives on the mount at /app/data (see
# render.yaml / railway.json / DEPLOY.md) and is bootstrapped from the
# committed snapshot on first boot.
FROM node:22-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    SEVA_DB_FILE=/app/data/seva-market.db

WORKDIR /app

COPY . .

RUN mkdir -p /app/data && chown -R node:node /app

USER node
EXPOSE 3000

# Container health check hits the real API.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/health || exit 1

CMD ["node", "scripts/start.js"]
