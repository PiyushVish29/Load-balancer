# node:20-slim (Debian/glibc), not alpine: Prisma's driver-adapter setup
# avoids needing its own query-engine binary at runtime, but staying off
# musl libc sidesteps any doubt about engine/binary-target mismatches.
FROM node:20-slim

WORKDIR /app

# Dummy value so `prisma generate` (npm ci's postinstall) can resolve
# DATABASE_URL while building - prisma.config.ts requires the env var to be
# present just to load, even though generate itself doesn't connect to a
# database. Overridden by docker-compose's real DATABASE_URL at container
# runtime (env vars supplied when a container runs take precedence over
# ENV values baked into the image).
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"

COPY package*.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci
# Explicit, idempotent re-run so client generation never silently depends on
# postinstall/allow-scripts behaving a particular way.
RUN npx prisma generate

COPY . .

ENV CONFIG_PATH=/app/config.docker.json
ENV PORT=8080
EXPOSE 8080

# Debian slim has no wget/curl by default and installing one just for this
# is unnecessary - node itself can make the request.
HEALTHCHECK --interval=5s --timeout=3s --start-period=15s --retries=5 \
  CMD node -e "require('http').get('http://localhost:8080/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

ENTRYPOINT ["sh", "docker/docker-entrypoint.sh"]
