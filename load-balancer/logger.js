const fs = require('fs');
const path = require('path');
const config = require('./config');

const LOG_FILE = config.log.filePath;
const MAX_MEMORY_LOGS = 1000;

const LEVELS = { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' };
const LEVEL_ORDER = { INFO: 0, WARN: 1, ERROR: 2 };
const MIN_LEVEL = LEVEL_ORDER[config.log.level];

const logDir = path.dirname(LOG_FILE);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const fileStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

// Ring buffer of the most recent log entries, kept in memory for a future
// dashboard to read without re-parsing the log file.
const recentLogs = [];

function pushToMemory(entry) {
  recentLogs.push(entry);
  if (recentLogs.length > MAX_MEMORY_LOGS) {
    recentLogs.shift();
  }
}

// Every line has the same shape: [ISO timestamp] [LEVEL] message
function write(level, message) {
  if (LEVEL_ORDER[level] < MIN_LEVEL) {
    return;
  }

  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${message}`;

  if (level === LEVELS.ERROR) {
    console.error(line);
  } else if (level === LEVELS.WARN) {
    console.warn(line);
  } else {
    console.log(line);
  }

  fileStream.write(line + '\n');
  pushToMemory({ timestamp, level, message });
}

function info(message) { write(LEVELS.INFO, message); }
function warn(message) { write(LEVELS.WARN, message); }
function error(message) { write(LEVELS.ERROR, message); }

function getRecentLogs(limit = MAX_MEMORY_LOGS) {
  return recentLogs.slice(-limit);
}

// --- Domain-specific helpers -------------------------------------------
// These wrap info/warn/error with a fixed "EVENT key=value ..." shape so
// every call site produces consistently formatted, greppable lines.

function logRequest({ method, path: reqPath, ip }) {
  info(`REQUEST method=${method} path=${reqPath} ip=${ip}`);
}

function logForward({ backend, method, path: reqPath, attempt }) {
  info(`FORWARD backend=${backend} method=${method} path=${reqPath} attempt=${attempt}`);
}

function logResponse({ backend, method, path: reqPath, status, durationMs }) {
  const level = status >= 500 ? LEVELS.ERROR : status >= 400 ? LEVELS.WARN : LEVELS.INFO;
  write(level, `RESPONSE backend=${backend || 'none'} method=${method} path=${reqPath} status=${status} durationMs=${durationMs}`);
}

function logHealthCheck({ backend, status, detail }) {
  info(`HEALTHCHECK backend=${backend} status=${status}${detail ? ` detail="${detail}"` : ''}`);
}

function logTransition({ backend, from, to, reason }) {
  const level = to === 'DOWN' ? LEVELS.WARN : LEVELS.INFO;
  write(level, `TRANSITION backend=${backend} from=${from} to=${to}${reason ? ` reason="${reason}"` : ''}`);
}

function logRetry({ backend, attempt, reason }) {
  warn(`RETRY backend=${backend} nextAttempt=${attempt} reason="${reason}"`);
}

function logFailover({ method, path: reqPath, triedServers }) {
  error(`FAILOVER_EXHAUSTED method=${method} path=${reqPath} triedServers=${triedServers}`);
}

function logAlgorithmSwitch({ from, to, source }) {
  info(`ALGORITHM_SWITCH from=${from} to=${to} source=${source}`);
}

module.exports = {
  LEVELS,
  info,
  warn,
  error,
  getRecentLogs,
  logRequest,
  logForward,
  logResponse,
  logHealthCheck,
  logTransition,
  logRetry,
  logFailover,
  logAlgorithmSwitch
};
