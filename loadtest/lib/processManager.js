const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const BACKEND_SERVER_DIR = path.join(__dirname, '..', '..', 'backend-server');
const LOAD_BALANCER_DIR = path.join(__dirname, '..', '..', 'load-balancer');

function getJson(url, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function waitForHealthy(url, { attempts = 30, delayMs = 500 } = {}) {
  for (let i = 0; i < attempts; i++) {
    try {
      const body = await getJson(url);
      if (body.status === 'ok') {
        return body;
      }
    } catch (error) {
      // not up yet - keep trying
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`${url} never became healthy after ${attempts} attempts`);
}

function spawnBackend(id, port) {
  const child = spawn('node', ['server.js'], {
    cwd: BACKEND_SERVER_DIR,
    env: { ...process.env, SERVER_ID: id, PORT: String(port) },
    stdio: 'ignore'
  });
  child.on('error', (error) => {
    console.error(`[processManager] ${id} failed to spawn: ${error.message}`);
  });
  return { id, port, child };
}

function spawnLoadBalancer() {
  const child = spawn('node', ['server.js'], {
    cwd: LOAD_BALANCER_DIR,
    env: { ...process.env },
    stdio: 'ignore'
  });
  child.on('error', (error) => {
    console.error(`[processManager] load-balancer failed to spawn: ${error.message}`);
  });
  return { id: 'load-balancer', port: 8080, child };
}

// Kills a spawned process reliably even though it's not the direct child
// (npm/cmd wrapper concerns don't apply here - `node server.js` is spawned
// directly, so child.pid IS the actual node process). taskkill /T ensures
// any of its own subprocesses die too; falls back to child.kill() off Windows.
function killProcess(proc) {
  return new Promise((resolve) => {
    if (!proc.child || proc.child.killed || proc.child.exitCode !== null) {
      resolve();
      return;
    }
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(proc.child.pid), '/T', '/F']).on('close', () => resolve());
    } else {
      proc.child.kill('SIGKILL');
      resolve();
    }
  });
}

// Frees a port before this script spawns its own tracked process there -
// run.js needs a real handle (child.pid) to kill a specific backend later
// for the failover scenario, so it always starts from a clean slate rather
// than trying to adopt whatever might already be listening.
function freePort(port) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve();
      return;
    }
    const ps = spawn('powershell', [
      '-NoProfile',
      '-Command',
      `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`
    ]);
    ps.on('close', () => resolve());
    ps.on('error', () => resolve());
  });
}

// Polls the load balancer's /health until a specific backend's isAlive flag
// matches what's expected, returning how long that took (ms) - or null on
// timeout. Used to measure real failure-detection and recovery time rather
// than assuming config.healthCheck.intervalMs.
async function waitForBackendStatus(healthUrl, backendId, expectedAlive, { timeoutMs = 8000, intervalMs = 50 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const body = await getJson(healthUrl).catch(() => null);
    const backend = body && (body.backends || []).find((b) => b.id === backendId);
    if (backend && backend.isAlive === expectedAlive) {
      return Date.now() - start;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

module.exports = {
  getJson,
  waitForHealthy,
  spawnBackend,
  spawnLoadBalancer,
  killProcess,
  freePort,
  waitForBackendStatus
};
