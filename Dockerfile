# PANIKA JEEVAN SATHI — production image
FROM node:22-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    PJS_DATA_DIR=/app/data

WORKDIR /app

# Install the locked mail dependency; no development tools or install scripts.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server.js ./
COPY lib ./lib
COPY public ./public
COPY scripts ./scripts

RUN mkdir -p /app/data/uploads && chown -R node:node /app

USER node
EXPOSE 3000

# Container health check hits the real API.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
