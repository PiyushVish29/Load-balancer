const fs = require('fs');
const path = require('path');
const http = require('http');
const config = require('./config');
const { servers, recordResponseTime, getAvgResponseTimeMs } = require('./backendServers');
const { algorithms } = require('./algorithms');
const { startHealthChecks } = require('./healthChecker');
const logger = require('./logger');
const metrics = require('./metricsService');
const bus = require('./eventBus');
const statsTracker = require('./statsTracker');
const { initSocketServer } = require('./socketServer');

const PORT = config.port;
const BACKEND_TIMEOUT_MS = 3000;
// Never try more backends than exist, regardless of what retryCount says.
const MAX_ATTEMPTS = Math.min(config.retryCount, servers.length);

// The active algorithm is mutable at runtime (via the /algorithm endpoint or
// a config.json edit) - always look it up through this function rather than
// caching the module reference, so a switch takes effect on the very next
// request without a restart.
let currentAlgorithm = config.algorithm;

function getCurrentAlgorithm() {
  return currentAlgorithm;
}

function setAlgorithm(name, source) {
  if (!algorithms[name]) {
    return { ok: false, error: `Unsupported algorithm "${name}". Supported: ${Object.keys(algorithms).join(', ')}` };
  }
  if (name === currentAlgorithm) {
    return { ok: true, changed: false, algorithm: currentAlgorithm };
  }
  const previous = currentAlgorithm;
  currentAlgorithm = name;
  logger.logAlgorithmSwitch({ from: previous, to: currentAlgorithm, source });
  bus.emit('algorithmSwitch', { from: previous, to: currentAlgorithm, source });
  return { ok: true, changed: true, algorithm: currentAlgorithm };
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendErrorResponse(res, statusCode, message) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  setCorsHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}

function sendJson(res, statusCode, body) {
  setCorsHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function collectRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Request path:
// client -> load balancer -> backend -> load balancer -> client
// The client request body is buffered once so it can be replayed against a
// second backend if the first one fails before sending a response.
// `ctx` carries the per-request fields (method/path/ip/start time/which
// backend last handled it, and how to release its connection count) that
// the top-level handler logs and cleans up when the response ends.
function forwardToServer(targetServer, req, body, res, triedServerIds, ctx) {
  targetServer.activeConnections += 1;
  ctx.lastBackend = targetServer.id;

  // activeConnections must be decremented exactly once no matter which of
  // several possible exit paths fires (normal completion, backend error,
  // timeout, or the client disconnecting) - release() makes that safe to
  // call from all of them.
  let released = false;
  function release() {
    if (released) {
      return;
    }
    released = true;
    targetServer.activeConnections -= 1;
  }
  ctx.releaseCurrent = release;

  const headers = { ...req.headers };
  delete headers['content-length'];
  delete headers['transfer-encoding'];
  headers['content-length'] = String(body.length);

  const backendOptions = {
    host: targetServer.host,
    port: targetServer.port,
    path: req.url,
    method: req.method,
    timeout: BACKEND_TIMEOUT_MS,
    headers
  };

  logger.logForward({ backend: targetServer.id, method: req.method, path: req.url, attempt: triedServerIds.length + 1 });

  const backendReq = http.request(backendOptions, (backendRes) => {
    res.writeHead(backendRes.statusCode, backendRes.headers);
    backendRes.pipe(res);

    backendRes.on('end', release);

    backendRes.on('error', (error) => {
      release();
      logger.error(`STREAM_ERROR backend=${targetServer.id} message="${error.message}"`);
      res.destroy();
    });
  });

  backendReq.on('timeout', () => {
    backendReq.destroy(new Error('timeout'));
  });

  backendReq.on('error', (error) => {
    release();

    // Once headers are already sent to the client we can't restart the
    // response on another backend, so the failure just ends the connection.
    if (res.headersSent) {
      logger.error(`STREAM_ERROR backend=${targetServer.id} message="${error.message}"`);
      res.destroy();
      return;
    }

    const wasAlive = targetServer.isAlive;
    targetServer.isAlive = false;
    if (wasAlive) {
      logger.logTransition({ backend: targetServer.id, from: 'UP', to: 'DOWN', reason: error.message });
      bus.emit('healthTransition', { backend: targetServer.id, from: 'UP', to: 'DOWN' });
    }
    logger.logRetry({ backend: targetServer.id, attempt: triedServerIds.length + 2, reason: error.message });

    attemptForward(req, body, res, [...triedServerIds, targetServer.id], ctx);
  });

  backendReq.end(body);
}

// Picks the next untried healthy server and forwards the request to it.
// triedServerIds grows by one on every connection-level failure, so this can
// recurse at most servers.length times before every server has been tried
// once - that bound is what prevents an infinite retry loop.
function attemptForward(req, body, res, triedServerIds, ctx) {
  if (triedServerIds.length >= MAX_ATTEMPTS) {
    logger.logFailover({ method: req.method, path: req.url, triedServers: triedServerIds.length });
    return sendErrorResponse(res, 503, 'No backend servers available');
  }

  const targetServer = algorithms[getCurrentAlgorithm()].getNextServer(triedServerIds);

  if (!targetServer) {
    logger.logFailover({ method: req.method, path: req.url, triedServers: triedServerIds.length });
    return sendErrorResponse(res, 503, 'No backend servers available');
  }

  forwardToServer(targetServer, req, body, res, triedServerIds, ctx);
}

function proxyRequest(req, res, ctx) {
  collectRequestBody(req)
    .then((body) => attemptForward(req, body, res, [], ctx))
    .catch((error) => {
      logger.warn(`CLIENT_ERROR method=${req.method} path=${req.url} message="${error.message}"`);
      sendErrorResponse(res, 400, 'Client request error');
    });
}

function handleAlgorithmEndpoint(req, res) {
  if (req.method === 'GET') {
    return sendJson(res, 200, { algorithm: getCurrentAlgorithm(), supported: Object.keys(algorithms) });
  }

  if (req.method === 'POST') {
    return collectRequestBody(req)
      .then((body) => {
        let parsed;
        try {
          parsed = JSON.parse(body.toString('utf8') || '{}');
        } catch (error) {
          return sendErrorResponse(res, 400, 'Invalid JSON body');
        }

        const result = setAlgorithm(parsed.algorithm, 'api');
        if (!result.ok) {
          return sendErrorResponse(res, 400, result.error);
        }
        return sendJson(res, 200, { algorithm: result.algorithm, changed: result.changed });
      })
      .catch((error) => {
        logger.warn(`CLIENT_ERROR method=${req.method} path=${req.url} message="${error.message}"`);
        sendErrorResponse(res, 400, 'Client request error');
      });
  }

  return sendErrorResponse(res, 405, 'Method not allowed');
}

// REST endpoints for the dashboard's historical views - all Postgres-backed
// via metricsService, all read-only, all resilient to the database being
// unavailable (503 instead of a hang or a crash). Live updates go over
// Socket.IO instead; these exist for a fresh page load and for charts that
// want more history than the in-memory event stream has seen.
function handleApiRequest(req, res) {
  const [pathname, queryString] = req.url.split('?');
  const params = new URLSearchParams(queryString || '');
  const limit = Number(params.get('limit')) || undefined;

  const routes = {
    '/api/metrics/requests-per-server': () => metrics.getRequestsPerServer(),
    '/api/metrics/avg-response-time-per-server': () => metrics.getAverageResponseTimePerServer(),
    '/api/metrics/requests-per-algorithm': () => metrics.getRequestsPerAlgorithm(),
    '/api/metrics/uptime-per-server': () => metrics.getUptimePercentagePerServer(),
    '/api/metrics/recent-requests': () => metrics.getRecentRequests(limit),
    '/api/logs/recent': () => Promise.resolve(logger.getRecentLogs(limit))
  };

  const handler = routes[pathname];
  if (!handler) {
    return sendErrorResponse(res, 404, 'Not found');
  }

  handler()
    .then((data) => sendJson(res, 200, data))
    .catch((error) => {
      logger.warn(`API_QUERY_FAILED path=${pathname} message="${error.message}"`);
      sendErrorResponse(res, 503, 'Metrics database unavailable');
    });
}

const loadBalancer = http.createServer((req, res) => {
  // Socket.IO is attached to this same http.Server below and handles its
  // own '/socket.io/*' requests via a separate 'request' listener - both
  // listeners fire for every request, so we must not also try to route
  // (and definitely not proxy) these ourselves.
  if (req.url.startsWith('/socket.io/')) {
    return;
  }

  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  const ctx = {
    method: req.method,
    path: req.url,
    ip: req.socket.remoteAddress,
    startTime: process.hrtime.bigint(),
    lastBackend: null,
    releaseCurrent: null
  };

  logger.logRequest({ method: ctx.method, path: ctx.path, ip: ctx.ip });

  let responded = false;
  res.on('finish', () => {
    responded = true;
    const durationMs = Number(process.hrtime.bigint() - ctx.startTime) / 1e6;
    const roundedDurationMs = Math.round(durationMs * 100) / 100;
    logger.logResponse({
      backend: ctx.lastBackend,
      method: ctx.method,
      path: ctx.path,
      status: res.statusCode,
      durationMs: roundedDurationMs
    });
    // Fire-and-forget - never awaited, so a slow/down database can't add
    // latency here or turn a successful response into a failed one.
    metrics.recordRequest({
      backendId: ctx.lastBackend,
      path: ctx.path,
      method: ctx.method,
      statusCode: res.statusCode,
      responseTimeMs: roundedDurationMs,
      algorithm: getCurrentAlgorithm()
    });

    // Only requests that actually reached the proxy path (not /health,
    // /algorithm, /api/*, which never touch a backend) should count toward
    // per-server/global request-serving stats and the live charts.
    if (ctx.lastBackend) {
      recordResponseTime(ctx.lastBackend, roundedDurationMs);
    }
    if (ctx.lastBackend || res.statusCode === 503) {
      statsTracker.recordCompletedRequest(roundedDurationMs);
      bus.emit('request', {
        backend: ctx.lastBackend,
        path: ctx.path,
        method: ctx.method,
        statusCode: res.statusCode,
        responseTimeMs: roundedDurationMs,
        algorithm: getCurrentAlgorithm(),
        timestamp: new Date().toISOString()
      });
    }
  });

  // Covers the client disconnecting before the backend response completes
  // ('close' fires on abnormal close too, not just after 'finish') -
  // releaseCurrent is idempotent with the normal release paths in
  // forwardToServer, so this never double-decrements.
  res.on('close', () => {
    if (ctx.releaseCurrent) {
      ctx.releaseCurrent();
    }
    if (!responded) {
      const durationMs = Number(process.hrtime.bigint() - ctx.startTime) / 1e6;
      logger.warn(`CLIENT_DISCONNECT backend=${ctx.lastBackend || 'none'} method=${ctx.method} path=${ctx.path} durationMs=${Math.round(durationMs * 100) / 100}`);
    }
  });

  if (req.url === '/health') {
    return sendJson(res, 200, {
      status: 'ok',
      loadBalancer: 'node-http-proxy',
      algorithm: getCurrentAlgorithm(),
      backends: servers.map(server => ({
        id: server.id,
        host: server.host,
        port: server.port,
        isAlive: server.isAlive,
        activeConnections: server.activeConnections,
        totalRequests: server.totalRequests,
        avgResponseTimeMs: getAvgResponseTimeMs(server)
      }))
    });
  }

  if (req.url === '/algorithm') {
    return handleAlgorithmEndpoint(req, res);
  }

  if (req.url.split('?')[0].startsWith('/api/')) {
    return handleApiRequest(req, res);
  }

  proxyRequest(req, res, ctx);
});

initSocketServer(loadBalancer, { getAlgorithm: getCurrentAlgorithm });

// Lets `algorithm` in config.json be changed live: on every save, re-read
// and re-validate the file and, if the algorithm field changed to a
// supported value, switch to it - same effect as the API endpoint, just
// triggered by the file instead of an HTTP call. Watching the containing
// directory (rather than the file itself) and filtering by filename because
// fs.watch on a single file misses editors/tools that save via
// write-to-temp-then-rename instead of an in-place write. Debounced because
// a save commonly fires more than one change event.
let configWatchTimer = null;
fs.watch(path.dirname(config.CONFIG_PATH), { persistent: false }, (eventType, filename) => {
  if (filename !== path.basename(config.CONFIG_PATH)) {
    return;
  }
  clearTimeout(configWatchTimer);
  configWatchTimer = setTimeout(() => {
    let fresh;
    try {
      fresh = config.reload();
    } catch (error) {
      logger.warn(`CONFIG_RELOAD_FAILED message="${error.message}"`);
      return;
    }
    setAlgorithm(fresh.algorithm, 'config-file');
  }, 150);
});

loadBalancer.listen(PORT, () => {
  logger.info(`Load balancer listening on http://localhost:${PORT}`);
  logger.info(`CONFIG algorithm=${config.algorithm} backends=${servers.map((s) => s.id).join(',')} retryCount=${config.retryCount} maxAttempts=${MAX_ATTEMPTS} healthCheckIntervalMs=${config.healthCheck.intervalMs} healthCheckTimeoutMs=${config.healthCheck.timeoutMs} logLevel=${config.log.level} logFile=${config.log.filePath}`);
  // Fire-and-forget - the port is already bound and accepting connections
  // by the time this callback runs, so a slow/unreachable database here
  // delays neither that nor the health checks starting below.
  metrics.syncServerRegistry(servers);
  startHealthChecks();
});
