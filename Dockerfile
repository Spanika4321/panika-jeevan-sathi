# PANIKA JEEVAN SATHI — production image
# Works on any Docker host: Render, Railway, Fly.io, a VPS, or cPanel Docker.
FROM node:22

WORKDIR /app
ENV NODE_ENV=production

# Install dependencies first (better layer caching)
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci

# Copy source + build
COPY . .
RUN npm run build

# The SQLite DB + user uploads live on the container's filesystem.
# On hosts with ephemeral disks, attach a persistent volume at /app/data
# (and /app/public/uploads) so registered users survive redeploys.
VOLUME ["/app/data", "/app/public/uploads"]

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
