
let totalRequests = 0;
let responseTimeSumMs = 0;
let requestsInCurrentWindow = 0;
let requestsPerSecond = 0;

function recordCompletedRequest(responseTimeMs) {
  totalRequests += 1;
  responseTimeSumMs += responseTimeMs;
  requestsInCurrentWindow += 1;
}


function tickRpsWindow() {
  requestsPerSecond = requestsInCurrentWindow;
  requestsInCurrentWindow = 0;
}

function getGlobalStats(algorithm) {
  return {
    totalRequests,
    requestsPerSecond,
    avgResponseTimeMs: totalRequests > 0 ? Math.round((responseTimeSumMs / totalRequests) * 100) / 100 : null,
    algorithm
  };
}

module.exports = {
  recordCompletedRequest,
  tickRpsWindow,
  getGlobalStats
};
