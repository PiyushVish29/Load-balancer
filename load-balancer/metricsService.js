require('dotenv').config({ quiet: true });
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');
const logger = require('./logger');

// Metrics persistence must never take the proxy down with it. PrismaClient
// connects lazily (no network call happens here), but construction itself
// can throw if DATABASE_URL is missing/malformed - guard it so a broken or
// absent database config just disables metrics instead of crashing startup.
let prisma = null;

// Prisma/adapter errors are often multi-line (query context, stack-like
// detail) - collapse to one line so every log entry stays on its own line,
// matching the rest of the logger's convention.
function flatten(message) {
  return message.replace(/\s+/g, ' ').trim();
}

try {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  prisma = new PrismaClient({ adapter });
} catch (error) {
  logger.warn(`METRICS_DISABLED reason="failed to initialize Prisma client: ${flatten(error.message)}"`);
}

// Fire-and-forget: callers never await these, so a slow or unreachable
// database can't add latency to request forwarding. Each write catches its
// own rejection independently - one failed write (or a whole DB outage)
// just gets logged and dropped, nothing throws back into the caller.
function recordRequest({ backendId, path, method, statusCode, responseTimeMs, algorithm }) {
  if (!prisma) {
    return;
  }
  prisma.requestRecord
    .create({
      data: {
        serverId: backendId || null,
        path,
        method,
        statusCode,
        responseTimeMs,
        algorithm
      }
    })
    .catch((error) => {
      logger.warn(`METRICS_WRITE_FAILED type=request message="${flatten(error.message)}"`);
    });
}

function recordHealthEvent({ serverId, oldStatus, newStatus }) {
  if (!prisma) {
    return;
  }
  prisma.healthEvent
    .create({ data: { serverId, oldStatus, newStatus } })
    .catch((error) => {
      logger.warn(`METRICS_WRITE_FAILED type=health message="${flatten(error.message)}"`);
    });
}

// Keeps the Server table in sync with config.json's backend list. Also
// fire-and-forget - called once at startup, must not delay the load
// balancer binding its port or starting health checks.
function syncServerRegistry(servers) {
  if (!prisma) {
    return;
  }
  Promise.all(
    servers.map((s) =>
      prisma.server.upsert({
        where: { id: s.id },
        update: { host: s.host, port: s.port },
        create: { id: s.id, host: s.host, port: s.port }
      })
    )
  )
    .then(() => logger.info(`METRICS_REGISTRY_SYNCED count=${servers.length}`))
    .catch((error) => {
      logger.warn(`METRICS_REGISTRY_SYNC_FAILED message="${flatten(error.message)}"`);
    });
}

// --- Aggregate queries for the dashboard --------------------------------
// These ARE awaited by whatever calls them (a future dashboard endpoint),
// unlike the fire-and-forget writes above - a dashboard request is allowed
// to wait on a query result, it just isn't on the request-forwarding path.

function requireDb() {
  if (!prisma) {
    throw new Error('Metrics database is not available');
  }
}

async function getRequestsPerServer() {
  requireDb();
  const rows = await prisma.requestRecord.groupBy({
    by: ['serverId'],
    _count: { _all: true }
  });
  return rows.map((r) => ({ serverId: r.serverId, requestCount: r._count._all }));
}

async function getAverageResponseTimePerServer() {
  requireDb();
  const rows = await prisma.requestRecord.groupBy({
    by: ['serverId'],
    _avg: { responseTimeMs: true }
  });
  return rows.map((r) => ({
    serverId: r.serverId,
    avgResponseTimeMs: r._avg.responseTimeMs === null ? null : Math.round(r._avg.responseTimeMs * 100) / 100
  }));
}

async function getRequestsPerAlgorithm() {
  requireDb();
  const rows = await prisma.requestRecord.groupBy({
    by: ['algorithm'],
    _count: { _all: true }
  });
  return rows.map((r) => ({ algorithm: r.algorithm, requestCount: r._count._all }));
}

// A server's uptime is the share of time its HealthEvent rows say it spent
// UP. Each event's newStatus is treated as holding until the next event (or
// until now, for the most recent one) - so this only covers time since the
// first recorded transition for that server, not before tracking began.
async function getUptimePercentagePerServer() {
  requireDb();
  const servers = await prisma.server.findMany();
  const now = new Date();
  const results = [];

  for (const server of servers) {
    const events = await prisma.healthEvent.findMany({
      where: { serverId: server.id },
      orderBy: { timestamp: 'asc' }
    });

    if (events.length === 0) {
      results.push({ serverId: server.id, uptimePercent: null });
      continue;
    }

    let upMs = 0;
    let totalMs = 0;
    for (let i = 0; i < events.length; i++) {
      const start = events[i].timestamp;
      const end = i + 1 < events.length ? events[i + 1].timestamp : now;
      const durationMs = end.getTime() - start.getTime();
      totalMs += durationMs;
      if (events[i].newStatus === 'UP') {
        upMs += durationMs;
      }
    }

    results.push({
      serverId: server.id,
      uptimePercent: totalMs > 0 ? Math.round((upMs / totalMs) * 10000) / 100 : null
    });
  }

  return results;
}

async function disconnect() {
  if (prisma) {
    await prisma.$disconnect();
  }
}

module.exports = {
  recordRequest,
  recordHealthEvent,
  syncServerRegistry,
  getRequestsPerServer,
  getAverageResponseTimePerServer,
  getRequestsPerAlgorithm,
  getUptimePercentagePerServer,
  disconnect
};
