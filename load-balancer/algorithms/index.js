const roundRobin = require('./roundRobin');
const leastConnections = require('./leastConnections');

const algorithms = {
  'round-robin': roundRobin,
  'least-connections': leastConnections
};

module.exports = { algorithms };
