const http = require('http');
const config = require('./config');
const { servers } = require('./backendServers');
const { algorithms } = require('./algorithms');
const { startHealthChecks } = require('./healthChecker');
const logger = require('./logger');

const PORT = config.port;
const BACKEND_TIMEOUT_MS = 3000;
const selectedAlgorithm = algorithms[config.algorithm];
// Never try more backends than exist, regardless of what retryCount says.
const MAX_ATTEMPTS = Math.min(config.retryCount, servers.length);

function sendErrorResponse(res, statusCode, message) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
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
// backend last handled it) that the res 'finish' listener logs at the end.
function forwardToServer(targetServer, req, body, res, triedServerIds, ctx) {
  targetServer.activeConnections += 1;
  ctx.lastBackend = targetServer.id;

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

    backendRes.on('end', () => {
      targetServer.activeConnections -= 1;
    });

    backendRes.on('error', (error) => {
      targetServer.activeConnections -= 1;
      logger.error(`STREAM_ERROR backend=${targetServer.id} message="${error.message}"`);
      res.destroy();
    });
  });

  backendReq.on('timeout', () => {
    backendReq.destroy(new Error('timeout'));
  });

  backendReq.on('error', (error) => {
    targetServer.activeConnections -= 1;

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

  const targetServer = selectedAlgorithm.getNextServer(triedServerIds);

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

const loadBalancer = http.createServer((req, res) => {
  const ctx = {
    method: req.method,
    path: req.url,
    ip: req.socket.remoteAddress,
    startTime: process.hrtime.bigint(),
    lastBackend: null
  };

  logger.logRequest({ method: ctx.method, path: ctx.path, ip: ctx.ip });

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - ctx.startTime) / 1e6;
    logger.logResponse({
      backend: ctx.lastBackend,
      method: ctx.method,
      path: ctx.path,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100
    });
  });

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      loadBalancer: 'node-http-proxy',
      algorithm: config.algorithm,
      backends: servers.map(server => ({
        id: server.id,
        host: server.host,
        port: server.port,
        isAlive: server.isAlive,
        activeConnections: server.activeConnections,
        totalRequests: server.totalRequests
      }))
    }));
    return;
  }

  proxyRequest(req, res, ctx);
});

loadBalancer.listen(PORT, () => {
  logger.info(`Load balancer listening on http://localhost:${PORT}`);
  logger.info(`CONFIG algorithm=${config.algorithm} backends=${servers.map((s) => s.id).join(',')} retryCount=${config.retryCount} maxAttempts=${MAX_ATTEMPTS} healthCheckIntervalMs=${config.healthCheck.intervalMs} healthCheckTimeoutMs=${config.healthCheck.timeoutMs} logLevel=${config.log.level} logFile=${config.log.filePath}`);
  startHealthChecks();
});
