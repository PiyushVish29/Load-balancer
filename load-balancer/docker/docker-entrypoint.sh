#!/bin/sh
set -e

echo "[entrypoint] waiting for database..."
node docker/wait-for-db.js

echo "[entrypoint] applying database migrations..."
npx prisma migrate deploy || echo "[entrypoint] migrate deploy failed or database still unreachable - continuing anyway, metrics will degrade gracefully"

echo "[entrypoint] starting load balancer..."
exec node server.js
