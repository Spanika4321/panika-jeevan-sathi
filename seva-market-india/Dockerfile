# SEVA MARKET INDIA — production image (Docker runtime on Render)
#
# Context: the Render service `seva-market-india` runs on the Docker runtime,
# so it builds from THIS file (this directory is the build context when the
# service's Root Directory is `seva-market-india`).
#
# Durability: the image does NOT try to keep data on its own disk. Render's
# free tier has an ephemeral filesystem — every deploy and every
# wake-from-sleep wipes it. Accounts and enquiries therefore live in
# Supabase Postgres (see scripts/supabase-storage.sql). The env below makes
# that mandatory: without SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY the app
# refuses to start instead of silently writing customers to a doomed disk.
FROM node:22-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    SEVA_STORAGE=supabase \
    SEVA_REQUIRE_REMOTE=1 \
    SEVA_SEED_ON_BOOT=1

WORKDIR /app

# Zero npm dependencies today; copy the manifest anyway so a future
# `npm install` layer is cached and the build keeps working.
COPY package.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev --ignore-scripts; \
    else npm install --omit=dev --ignore-scripts; fi

# Application source and static assets.
COPY server.js ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts

# The catalog SQLite file is regenerated at boot from seed data; pre-creating
# the directory keeps the first write free of permission surprises.
RUN mkdir -p /app/data && chown -R node:node /app

USER node
EXPOSE 3000

# Container health check hits the real API.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/health || exit 1

CMD ["node", "server.js"]
