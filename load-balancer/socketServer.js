const { Server } = require('socket.io');
const bus = require('./eventBus');
const { servers, getAvgResponseTimeMs } = require('./backendServers');
const statsTracker = require('./statsTracker');
const logger = require('./logger');

const STATS_TICK_MS = 1000;

let io = null;
let getCurrentAlgorithm = () => null;

function poolSnapshot() {
  return servers.map((server) => ({
    id: server.id,
    host: server.host,
    port: server.port,
    isAlive: server.isAlive,
    activeConnections: server.activeConnections,
    totalRequests: server.totalRequests,
    avgResponseTimeMs: getAvgResponseTimeMs(server)
  }));
}

function broadcastPool() {
  if (io) {
    io.emit('pool:update', poolSnapshot());
  }
}

function broadcastStats() {
  if (io) {
    io.emit('stats:update', statsTracker.getGlobalStats(getCurrentAlgorithm()));
  }
}


function initSocketServer(httpServer, { getAlgorithm }) {
  getCurrentAlgorithm = getAlgorithm;

  io = new Server(httpServer, {
    cors: { origin: '*' }
  });

  io.on('connection', (socket) => {
    // Bring a newly-connected dashboard up to date immediately, rather than
    // leaving it blank until the next event happens to fire.
    socket.emit('pool:update', poolSnapshot());
    socket.emit('stats:update', statsTracker.getGlobalStats(getCurrentAlgorithm()));
    socket.emit('logs:initial', logger.getRecentLogs(200));
  });

 
  bus.on('healthTransition', () => broadcastPool());

  bus.on('request', (payload) => {
    io.emit('request:new', payload);
  });

  bus.on('log', (entry) => {
    io.emit('log:new', entry);
  });

  bus.on('algorithmSwitch', (payload) => {
    io.emit('algorithm:changed', payload);
    broadcastStats();
  });

  // activeConnections/totalRequests change on every request, not just on
  // transitions - a steady tick keeps the cards and global stats fresh
  // without broadcasting on every single request.
  setInterval(() => {
    statsTracker.tickRpsWindow();
    broadcastStats();
    broadcastPool();
  }, STATS_TICK_MS);

  return io;
}

module.exports = { initSocketServer };
