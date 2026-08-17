// Backend distribution needs no extra instrumentation on the load balancer -
// /health already reports each server's cumulative totalRequests, so a
// before/after snapshot around a scenario gives the exact per-backend count
// for just that run.
function snapshotBackendRequests(healthBody) {
  const snapshot = {};
  (healthBody.backends || []).forEach((b) => {
    snapshot[b.id] = b.totalRequests;
  });
  return snapshot;
}

function diffBackendRequests(before, after) {
  const distribution = {};
  for (const id of Object.keys(after)) {
    distribution[id] = (after[id] || 0) - (before[id] || 0);
  }
  return distribution;
}

function summarize(result) {
  return {
    durationSec: Math.round(result.duration * 100) / 100,
    connections: result.connections,
    totalRequests: result.requests.total,
    requestsPerSec: Math.round(result.requests.average * 100) / 100,
    latencyMs: {
      average: result.latency.average,
      p97_5: result.latency.p97_5,
      max: result.latency.max
    },
    errors: result.errors,
    timeouts: result.timeouts,
    non2xx: result.non2xx,
    allSuccessful: result.errors === 0 && result.timeouts === 0 && result.non2xx === 0,
    statusCodes: result.statusCodeStats
  };
}

function padRight(value, width) {
  const s = String(value);
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function printScenarioSummary(scenario) {
  const s = scenario.summary;
  console.log(`\n=== ${scenario.name} ===`);
  console.log(scenario.description);
  console.log(`  requests/sec (avg): ${s.requestsPerSec}`);
  console.log(`  latency ms - avg: ${s.latencyMs.average}  p97.5: ${s.latencyMs.p97_5}  max: ${s.latencyMs.max}`);
  console.log(`  total requests: ${s.totalRequests}  errors: ${s.errors}  timeouts: ${s.timeouts}  non-2xx: ${s.non2xx}`);
  if (scenario.distribution) {
    const dist = Object.entries(scenario.distribution)
      .map(([id, count]) => `${id}=${count}`)
      .join('  ');
    console.log(`  backend distribution: ${dist}`);
  }
  if (scenario.note) {
    console.log(`  note: ${scenario.note}`);
  }
}

function printFinalTable(scenarios) {
  console.log('\n' + '='.repeat(78));
  console.log('SUMMARY');
  console.log('='.repeat(78));
  const header = ['scenario', 'req/s', 'lat avg', 'lat p97.5', 'lat max', 'errors'];
  const widths = [28, 10, 10, 10, 10, 8];
  console.log(header.map((h, i) => padRight(h, widths[i])).join(''));
  scenarios.forEach((scenario) => {
    const s = scenario.summary;
    const row = [
      scenario.name,
      s.requestsPerSec,
      s.latencyMs.average,
      s.latencyMs.p97_5,
      s.latencyMs.max,
      s.errors + s.timeouts + s.non2xx
    ];
    console.log(row.map((v, i) => padRight(v, widths[i])).join(''));
  });
  console.log('='.repeat(78));
}

module.exports = {
  snapshotBackendRequests,
  diffBackendRequests,
  summarize,
  printScenarioSummary,
  printFinalTable
};
