const { servers } = require('../backendServers');

// Only used to break ties between servers with an equal activeConnections
// count - rotates the starting point each call so a tie doesn't always
// favor the same server.
let rotationIndex = 0;

function getHealthyServers() {
  return servers.filter((server) => server.isAlive === true);
}

function getNextServer(excludeIds = []) {
  const healthyServers = getHealthyServers().filter((server) => !excludeIds.includes(server.id));

  if (healthyServers.length === 0) {
    return null;
  }

  const startIndex = rotationIndex % healthyServers.length;
  rotationIndex = (rotationIndex + 1) % healthyServers.length;

  let chosen = healthyServers[startIndex];
  for (let i = 1; i < healthyServers.length; i++) {
    const candidate = healthyServers[(startIndex + i) % healthyServers.length];
    if (candidate.activeConnections < chosen.activeConnections) {
      chosen = candidate;
    }
  }

  chosen.totalRequests += 1;
  return chosen;
}

function resetLeastConnections() {
  rotationIndex = 0;
}

module.exports = {
  getNextServer,
  resetLeastConnections,
  getHealthyServers
};
