import { LB_URL } from './config';

async function getJson(path) {
  const res = await fetch(`${LB_URL}${path}`);
  if (!res.ok) {
    throw new Error(`${path} failed: ${res.status}`);
  }
  return res.json();
}

export function fetchRecentRequests(limit = 200) {
  return getJson(`/api/metrics/recent-requests?limit=${limit}`);
}

export function fetchRecentLogs(limit = 200) {
  return getJson(`/api/logs/recent?limit=${limit}`);
}

export function fetchUptimePerServer() {
  return getJson('/api/metrics/uptime-per-server');
}

export async function switchAlgorithm(algorithm) {
  const res = await fetch(`${LB_URL}/algorithm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ algorithm })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `switch failed: ${res.status}`);
  }
  return body;
}
