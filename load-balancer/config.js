const fs = require('fs');
const path = require('path');

// Overridable so a container can point at a docker-specific config (backend
// hosts as container names instead of 127.0.0.1) without touching the file
// local dev uses - unset, this is unchanged from before.
const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname, 'config.json');

const SUPPORTED_ALGORITHMS = ['round-robin', 'least-connections'];
const LOG_LEVELS = ['INFO', 'WARN', 'ERROR'];

const DEFAULTS = {
  port: 8080,
  backends: [
    { id: 'backend-1', host: '127.0.0.1', port: 3001 },
    { id: 'backend-2', host: '127.0.0.1', port: 3002 },
    { id: 'backend-3', host: '127.0.0.1', port: 3003 }
  ],
  algorithm: 'round-robin',
  healthCheck: { intervalMs: 5000, timeoutMs: 1500 },
  retryCount: 3,
  log: { filePath: path.join(__dirname, '..', 'logs', 'load-balancer.log'), level: 'INFO' }
};

// Config validation runs before the app's logger exists (the logger needs
// this module's output to know where to write), so problems here go to
// plain console.warn rather than the structured logger.
function warnDefault(field, reason) {
  console.warn(`[config] ${field}: ${reason} - using default`);
}

function isPositiveInt(value) {
  return Number.isInteger(value) && value > 0;
}

function isValidPort(value) {
  return Number.isInteger(value) && value > 0 && value <= 65535;
}

function resolveField(value, isValid, fieldName, defaultValue) {
  if (isValid(value)) {
    return value;
  }
  warnDefault(fieldName, `invalid value ${JSON.stringify(value)}`);
  return defaultValue;
}

function validateBackends(rawBackends) {
  if (!Array.isArray(rawBackends) || rawBackends.length === 0) {
    warnDefault('backends', 'missing or empty');
    return DEFAULTS.backends;
  }

  const seenIds = new Set();
  const validated = [];

  rawBackends.forEach((backend, index) => {
    const valid = backend
      && typeof backend.id === 'string' && backend.id.trim() !== ''
      && typeof backend.host === 'string' && backend.host.trim() !== ''
      && isValidPort(backend.port);

    if (!valid) {
      warnDefault(`backends[${index}]`, 'invalid entry (needs string id, string host, valid port) - skipped');
      return;
    }

    if (seenIds.has(backend.id)) {
      warnDefault(`backends[${index}]`, `duplicate id "${backend.id}" - skipped`);
      return;
    }

    seenIds.add(backend.id);
    validated.push({ id: backend.id, host: backend.host, port: backend.port });
  });

  if (validated.length === 0) {
    warnDefault('backends', 'no valid entries after validation');
    return DEFAULTS.backends;
  }

  return validated;
}

function validateConfig(raw) {
  const config = {};

  config.port = resolveField(raw.port, isValidPort, 'port', DEFAULTS.port);
  config.backends = validateBackends(raw.backends);
  config.algorithm = resolveField(
    raw.algorithm,
    (v) => typeof v === 'string' && SUPPORTED_ALGORITHMS.includes(v),
    'algorithm',
    DEFAULTS.algorithm
  );

  const rawHealthCheck = raw.healthCheck || {};
  config.healthCheck = {
    intervalMs: resolveField(rawHealthCheck.intervalMs, isPositiveInt, 'healthCheck.intervalMs', DEFAULTS.healthCheck.intervalMs),
    timeoutMs: resolveField(rawHealthCheck.timeoutMs, isPositiveInt, 'healthCheck.timeoutMs', DEFAULTS.healthCheck.timeoutMs)
  };

  config.retryCount = resolveField(raw.retryCount, isPositiveInt, 'retryCount', DEFAULTS.retryCount);

  const rawLog = raw.log || {};
  const resolvedFilePath = typeof rawLog.filePath === 'string' && rawLog.filePath.trim() !== ''
    ? path.resolve(__dirname, rawLog.filePath)
    : undefined;
  const normalizedLevel = typeof rawLog.level === 'string' ? rawLog.level.toUpperCase() : undefined;

  config.log = {
    filePath: resolveField(resolvedFilePath, (v) => typeof v === 'string', 'log.filePath', DEFAULTS.log.filePath),
    level: resolveField(normalizedLevel, (v) => LOG_LEVELS.includes(v), 'log.level', DEFAULTS.log.level)
  };

  return config;
}

function loadConfig() {
  let raw = {};

  if (fs.existsSync(CONFIG_PATH)) {
    try {
      raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (error) {
      console.warn(`[config] failed to parse ${CONFIG_PATH}: ${error.message} - using all defaults`);
      raw = {};
    }
  } else {
    console.warn(`[config] ${CONFIG_PATH} not found - using all defaults`);
  }

  return validateConfig(raw);
}

// Loaded and validated once; every require() of this module gets the same
// cached object (Node caches modules), so config is parsed exactly once at
// startup. reload() re-reads and re-validates config.json on demand, for
// callers (see server.js's config.json watcher) that want to react to
// runtime edits without a process restart.
module.exports = loadConfig();
module.exports.SUPPORTED_ALGORITHMS = SUPPORTED_ALGORITHMS;
module.exports.LOG_LEVELS = LOG_LEVELS;
module.exports.CONFIG_PATH = CONFIG_PATH;
module.exports.reload = loadConfig;
