const config = require('./config');

const servers = config.backends.map((backend) => ({
  id: backend.id,
  host: backend.host,
  port: backend.port,
  isAlive: true,
  activeConnections: 0,
  totalRequests: 0,
  
  totalResponseTimeMs: 0,
  completedResponses: 0
}));

function findServer(id) {
  return servers.find((server) => server.id === id);
}

function recordResponseTime(id, responseTimeMs) {
  const server = findServer(id);
  if (!server) {
    return;
  }
  server.totalResponseTimeMs += responseTimeMs;
  server.completedResponses += 1;
}

function getAvgResponseTimeMs(server) {
  return server.completedResponses > 0
    ? Math.round((server.totalResponseTimeMs / server.completedResponses) * 100) / 100
    : null;
}

module.exports = {
  servers,
  findServer,
  recordResponseTime,
  getAvgResponseTimeMs
};
