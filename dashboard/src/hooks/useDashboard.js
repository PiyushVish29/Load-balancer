import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { LB_URL } from '../config';
import { fetchRecentRequests, fetchRecentLogs, switchAlgorithm as apiSwitchAlgorithm } from '../api';

const MAX_LOGS = 200;
const MAX_BUCKETS = 30; // ~30 seconds of live chart history

function bucketKey(date) {
  return date.toLocaleTimeString('en-GB', { hour12: false });
}

function emptyBucket() {
  return { counts: {}, sums: {} };
}

function accumulate(bucket, backend, responseTimeMs) {
  bucket.counts[backend] = (bucket.counts[backend] || 0) + 1;
  if (!bucket.sums[backend]) {
    bucket.sums[backend] = { sum: 0, count: 0 };
  }
  bucket.sums[backend].sum += responseTimeMs;
  bucket.sums[backend].count += 1;
}

function avgResponseTimes(bucket) {
  const result = {};
  for (const [backend, { sum, count }] of Object.entries(bucket.sums)) {
    result[backend] = Math.round((sum / count) * 100) / 100;
  }
  return result;
}

// Keyed by time-bucket ("HH:MM:SS") so the historical seed fetch and the
// once-a-second live tick can both contribute to the same series without
// one wholesale-replacing whatever the other already wrote - whichever of
// the two resolves/fires first no longer matters.
function makeSeries() {
  const map = new Map();

  function merge(time, values) {
    const existing = map.get(time) || { time };
    map.set(time, { ...existing, ...values });
    if (map.size > MAX_BUCKETS) {
      map.delete(map.keys().next().value);
    }
  }

  function toArray() {
    return Array.from(map.values());
  }

  return { merge, toArray };
}

// Single source of truth for all live dashboard data. Everything here comes
// from one Socket.IO connection to the load balancer, seeded once on mount
// by a couple of REST calls so charts and the log panel aren't empty on
// first paint. Chart time-series are bucketed client-side by second from
// raw request:new events - the backend just streams events, it doesn't do
// time-series aggregation itself.
export function useDashboard() {
  const [connected, setConnected] = useState(false);
  const [pool, setPool] = useState([]);
  const [stats, setStats] = useState({ totalRequests: 0, requestsPerSecond: 0, avgResponseTimeMs: null, algorithm: null });
  const [logs, setLogs] = useState([]);
  const [requestChartData, setRequestChartData] = useState([]);
  const [responseTimeChartData, setResponseTimeChartData] = useState([]);

  const currentBucketRef = useRef(emptyBucket());
  const requestSeriesRef = useRef(makeSeries());
  const responseSeriesRef = useRef(makeSeries());

  const pushLog = useCallback((entry) => {
    setLogs((prev) => {
      const next = [...prev, entry];
      return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next;
    });
  }, []);

  useEffect(() => {
    const socket = io(LB_URL, { transports: ['websocket', 'polling'] });

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('pool:update', setPool);
    socket.on('stats:update', setStats);
    socket.on('logs:initial', (data) => setLogs(data.slice(-MAX_LOGS)));
    socket.on('log:new', pushLog);
    socket.on('algorithm:changed', ({ to }) => {
      setStats((prev) => ({ ...prev, algorithm: to }));
    });
    socket.on('request:new', ({ backend, responseTimeMs }) => {
      accumulate(currentBucketRef.current, backend || 'none', responseTimeMs);
    });

    // Seed chart history from Postgres; if the database is unavailable this
    // just fails quietly and the charts start empty and fill in live. Only
    // rows from the last MAX_BUCKETS seconds are used - otherwise sparse
    // traffic from a much older test session produces a chart with huge,
    // confusing gaps instead of a coherent recent window.
    fetchRecentRequests(300)
      .then((rows) => {
        const cutoff = Date.now() - MAX_BUCKETS * 1000;
        const buckets = new Map();
        rows
          .filter((row) => new Date(row.timestamp).getTime() >= cutoff)
          .forEach((row) => {
            const key = bucketKey(new Date(row.timestamp));
            if (!buckets.has(key)) {
              buckets.set(key, emptyBucket());
            }
            accumulate(buckets.get(key), row.serverId || 'none', row.responseTimeMs);
          });

        for (const [time, bucket] of buckets.entries()) {
          requestSeriesRef.current.merge(time, bucket.counts);
          responseSeriesRef.current.merge(time, avgResponseTimes(bucket));
        }
        setRequestChartData(requestSeriesRef.current.toArray());
        setResponseTimeChartData(responseSeriesRef.current.toArray());
      })
      .catch(() => {});

    fetchRecentLogs(MAX_LOGS)
      .then((data) => setLogs(data.slice(-MAX_LOGS)))
      .catch(() => {});

    const tick = setInterval(() => {
      const time = bucketKey(new Date());
      const bucket = currentBucketRef.current;

      requestSeriesRef.current.merge(time, bucket.counts);
      responseSeriesRef.current.merge(time, avgResponseTimes(bucket));

      setRequestChartData(requestSeriesRef.current.toArray());
      setResponseTimeChartData(responseSeriesRef.current.toArray());

      currentBucketRef.current = emptyBucket();
    }, 1000);

    return () => {
      clearInterval(tick);
      socket.disconnect();
    };
  }, [pushLog]);

  const switchAlgorithm = useCallback(async (algorithm) => {
    await apiSwitchAlgorithm(algorithm);
  }, []);

  return { connected, pool, stats, logs, requestChartData, responseTimeChartData, switchAlgorithm };
}
