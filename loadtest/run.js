const fs = require('fs');
const path = require('path');
const http = require('http');
const autocannon = require('autocannon');
const {
  getJson,
  waitForHealthy,
  spawnBackend,
  spawnLoadBalancer,
  killProcess,
  freePort
} = require('./lib/processManager');
const {
  snapshotBackendRequests,
  diffBackendRequests,
  summarize,
  printScenarioSummary,
  printFinalTable
} = require('./lib/report');

const LB_URL = 'http://localhost:8080';
const BACKEND_PORTS = { 'backend-1': 3001, 'backend-2': 3002, 'backend-3': 3003 };
const RESULTS_DIR = path.join(__dirname, 'results');

function parseArgs() {
  const opts = { connections: 20, duration: 10 };
  process.argv.slice(2).forEach((arg) => {
    const match = arg.match(/^--(connections|duration)=(\d+)$/);
    if (match) {
      opts[match[1]] = Number(match[2]);
    }
  });
  return opts;
}

function runAutocannon(opts) {
  return new Promise((resolve, reject) => {
    autocannon(opts, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

function setAlgorithm(name) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ algorithm: name });
    const req = http.request(
      `${LB_URL}/algorithm`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const { connections, duration } = parseArgs();
  console.log(`Load test config: ${connections} connections, ${duration}s per scenario`);

  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  // --- bring up a clean, fully self-managed stack -------------------------
  console.log('\nClearing ports 3001-3003 and 8080...');
  await Promise.all([3001, 3002, 3003, 8080].map((port) => freePort(port)));

  console.log('Starting a fresh backend + load balancer stack...');
  const backendProcs = {
    'backend-1': spawnBackend('backend-1', BACKEND_PORTS['backend-1']),
    'backend-2': spawnBackend('backend-2', BACKEND_PORTS['backend-2']),
    'backend-3': spawnBackend('backend-3', BACKEND_PORTS['backend-3'])
  };
  let lbProc = spawnLoadBalancer();

  await Promise.all(
    Object.entries(BACKEND_PORTS).map(([id, port]) => waitForHealthy(`http://localhost:${port}/health`))
  );
  await waitForHealthy(`${LB_URL}/health`, { attempts: 40 });
  console.log('Stack is up.');

  const scenarios = [];

  try {
    // --- scenario 1: baseline, single backend, no load balancer -----------
    console.log('\nRunning scenario: baseline (single backend, no load balancer)...');
    const baselineResult = await runAutocannon({
      url: `http://localhost:${BACKEND_PORTS['backend-1']}`,
      connections,
      duration
    });
    scenarios.push({
      name: 'baseline-single-backend',
      description: `Direct load on backend-1 alone, load balancer not involved (${connections} conn, ${duration}s).`,
      summary: summarize(baselineResult),
      distribution: null
    });

    // --- scenario 2: round robin through the load balancer -----------------
    console.log('\nRunning scenario: round robin through the load balancer...');
    await setAlgorithm('round-robin');
    await sleep(300);
    let before = snapshotBackendRequests(await getJson(`${LB_URL}/health`));
    const rrResult = await runAutocannon({ url: LB_URL, connections, duration });
    let after = snapshotBackendRequests(await getJson(`${LB_URL}/health`));
    scenarios.push({
      name: 'round-robin',
      description: `Same load through the load balancer on Round Robin (${connections} conn, ${duration}s).`,
      summary: summarize(rrResult),
      distribution: diffBackendRequests(before, after)
    });

    // --- scenario 3: least connections through the load balancer -----------
    console.log('\nRunning scenario: least connections through the load balancer...');
    await setAlgorithm('least-connections');
    await sleep(300);
    before = snapshotBackendRequests(await getJson(`${LB_URL}/health`));
    const lcResult = await runAutocannon({ url: LB_URL, connections, duration });
    after = snapshotBackendRequests(await getJson(`${LB_URL}/health`));
    scenarios.push({
      name: 'least-connections',
      description: `Same load through the load balancer on Least Connections (${connections} conn, ${duration}s).`,
      summary: summarize(lcResult),
      distribution: diffBackendRequests(before, after)
    });

    // --- scenario 4: mixed fast/slow workload -------------------------------
    console.log('\nRunning scenario: mixed fast/slow workload...');
    await setAlgorithm('round-robin');
    await sleep(300);
    before = snapshotBackendRequests(await getJson(`${LB_URL}/health`));
    const mixedResult = await runAutocannon({
      url: LB_URL,
      connections,
      duration,
      requests: [{ method: 'GET', path: '/' }, { method: 'GET', path: '/work' }]
    });
    after = snapshotBackendRequests(await getJson(`${LB_URL}/health`));
    scenarios.push({
      name: 'mixed-fast-slow',
      description: `Round Robin, alternating fast (/) and slow (/work, ~300ms) requests (${connections} conn, ${duration}s).`,
      summary: summarize(mixedResult),
      distribution: diffBackendRequests(before, after)
    });

    // --- scenario 5: failover under load ------------------------------------
    console.log('\nRunning scenario: failover under load (kills backend-2 mid-run)...');
    await setAlgorithm('round-robin');
    await sleep(300);
    before = snapshotBackendRequests(await getJson(`${LB_URL}/health`));

    const failoverPromise = runAutocannon({ url: LB_URL, connections, duration });
    const killAtMs = Math.round((duration * 1000) / 3);
    await sleep(killAtMs);
    console.log(`  [t+${killAtMs}ms] killing backend-2...`);
    await killProcess(backendProcs['backend-2']);
    console.log('  backend-2 killed - load test continues...');

    const failoverResult = await failoverPromise;
    after = snapshotBackendRequests(await getJson(`${LB_URL}/health`));

    // Restart backend-2 so the stack is left healthy.
    backendProcs['backend-2'] = spawnBackend('backend-2', BACKEND_PORTS['backend-2']);
    await waitForHealthy(`http://localhost:${BACKEND_PORTS['backend-2']}/health`);
    console.log('  backend-2 restarted.');

    const failoverSummary = summarize(failoverResult);
    scenarios.push({
      name: 'failover-under-load',
      description: `Round Robin, backend-2 killed at t+${killAtMs}ms of a ${duration}s run (${connections} conn). Client must see zero failures.`,
      summary: failoverSummary,
      distribution: diffBackendRequests(before, after),
      note: failoverSummary.allSuccessful
        ? 'PASS - zero errors/timeouts/non-2xx despite the mid-run kill.'
        : 'FAIL - client-visible failures occurred during failover.'
    });
  } finally {
    console.log('\nTearing down the stack...');
    await Promise.all([
      killProcess(backendProcs['backend-1']),
      killProcess(backendProcs['backend-2']),
      killProcess(backendProcs['backend-3']),
      killProcess(lbProc)
    ]);
  }

  scenarios.forEach(printScenarioSummary);
  printFinalTable(scenarios);

  const output = {
    generatedAt: new Date().toISOString(),
    config: { connections, duration },
    scenarios
  };

  const timestamp = output.generatedAt.replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(RESULTS_DIR, `results-${timestamp}.json`), JSON.stringify(output, null, 2));
  fs.writeFileSync(path.join(RESULTS_DIR, 'latest.json'), JSON.stringify(output, null, 2));
  console.log(`\nResults written to loadtest/results/latest.json`);

  const failed = scenarios.find((s) => s.name === 'failover-under-load' && !s.summary.allSuccessful);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error('Load test run failed:', error);
  process.exit(1);
});
