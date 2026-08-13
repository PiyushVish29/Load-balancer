const config = require('./config');

const servers = config.backends.map((backend) => ({
  id: backend.id,
  host: backend.host,
  port: backend.port,
  isAlive: true,
  activeConnections: 0,
  totalRequests: 0
}));

module.exports = {
  servers
};
