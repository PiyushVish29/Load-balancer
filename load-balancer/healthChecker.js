const http = require('http');
const config = require('./config');
const { servers } = require('./backendServers');
const logger = require('./logger');
const metrics = require('./metricsService');
const bus = require('./eventBus');

const DEFAULT_INTERVAL_MS = config.healthCheck.intervalMs;
const DEFAULT_TIMEOUT_MS = config.healthCheck.timeoutMs;

function printPoolStatus(label = 'cycle') {
  const summary = servers
    .map((server) => `${server.id}=${server.isAlive ? 'UP' : 'DOWN'}(conn=${server.activeConnections},req=${server.totalRequests})`)
    .join(' ');

  logger.info(`HEALTHCHECK_CYCLE label=${label} ${summary}`);
}

function checkBackendHealth(server, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const previousState = server.isAlive;

    const request = http.request(
      {
        host: server.host,
        port: server.port,
        path: '/health',
        method: 'GET',
        timeout: timeoutMs,
        headers: {
          Accept: 'application/json'
        }
      },
      (response) => {
        const statusCode = response.statusCode || 0;
        const isHealthy = statusCode === 200;

        response.resume();

        server.isAlive = isHealthy;
        logger.logHealthCheck({ backend: server.id, status: isHealthy ? 'UP' : 'DOWN', detail: `HTTP ${statusCode}` });

        if (previousState !== server.isAlive) {
          const from = previousState ? 'UP' : 'DOWN';
          const to = server.isAlive ? 'UP' : 'DOWN';
          logger.logTransition({ backend: server.id, from, to, reason: `HTTP ${statusCode}` });
          metrics.recordHealthEvent({ serverId: server.id, oldStatus: from, newStatus: to });
          bus.emit('healthTransition', { backend: server.id, from, to });
        }

        resolve(server.isAlive);
      }
    );

    request.on('timeout', () => {
      request.destroy(new Error('timeout'));
    });

    request.on('error', (error) => {
      server.isAlive = false;
      logger.logHealthCheck({ backend: server.id, status: 'DOWN', detail: error.message });

      if (previousState !== false) {
        logger.logTransition({ backend: server.id, from: 'UP', to: 'DOWN', reason: error.message });
        metrics.recordHealthEvent({ serverId: server.id, oldStatus: 'UP', newStatus: 'DOWN' });
        bus.emit('healthTransition', { backend: server.id, from: 'UP', to: 'DOWN' });
      }

      resolve(false);
    });

    request.end();
  });
}

function startHealthChecks({ intervalMs = DEFAULT_INTERVAL_MS, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  printPoolStatus('initial');

  const timer = setInterval(() => {
    Promise.all(servers.map((server) => checkBackendHealth(server, timeoutMs)))
      .then(() => {
        printPoolStatus('cycle');
      })
      .catch((error) => {
        logger.error(`HEALTHCHECK_CYCLE_FAILED message="${error.message}"`);
      });
  }, intervalMs);

  return {
    timer,
    checkOnce: () => Promise.all(servers.map((server) => checkBackendHealth(server, timeoutMs)))
  };
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  DEFAULT_TIMEOUT_MS,
  checkBackendHealth,
  printPoolStatus,
  startHealthChecks
};
