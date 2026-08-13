const { servers } = require('../backendServers');

let rotationIndex = 0;

function getHealthyServers() {
  return servers.filter(server => server.isAlive === true);
}

function getNextServer(excludeIds = []) {
  const healthyServers = getHealthyServers().filter((server) => !excludeIds.includes(server.id));

  if (healthyServers.length === 0) {
    return null;
  }

  const chosen = healthyServers[rotationIndex % healthyServers.length];
  rotationIndex = (rotationIndex + 1) % healthyServers.length;

  chosen.totalRequests += 1;
  return chosen;
}

function resetRoundRobin() {
  rotationIndex = 0;
}

module.exports = {
  getNextServer,
  resetRoundRobin,
  getHealthyServers
};
