# Mini Load Balancer

A small, dependency-light HTTP load balancer written in plain Node.js. It round-robins
traffic across a configurable pool of backend servers, health-checks them in the
background, automatically fails a request over to the next healthy backend when one
dies mid-request, and logs every request, health check, and failover event to console
and to a log file.

## Architecture

```text
client -> load balancer (:8080) -> backend-1 (:3001)
                                 -> backend-2 (:3002)
                                 -> backend-3 (:3003)
```

- The load balancer buffers each incoming request body, then forwards it to the next
  healthy backend, chosen by the active algorithm (Round Robin or Least Connections -
  see below, switchable live).
- A background health checker polls every backend's `/health` endpoint on an interval
  and flips its alive/dead state on status change.
- If a forward fails at request time (connection refused, reset, or timeout), that
  backend is marked dead immediately and the **same request** is retried on the next
  healthy backend - the client never sees the failure. Retries are capped so a request
  can never loop forever.
- If every backend is down, the client gets a clean `503` with a JSON error body
  instead of a hang or a crash.
- A recovered backend rejoins rotation automatically on its next successful health
  check - no load balancer restart needed.

## Folder structure

```text
load balancer/
├─ README.md
├─ postman/
│  └─ load-balancer.postman_collection.json
├─ backend-server/                  the backend used by every instance
│  ├─ server.js                     reads SERVER_ID / PORT from env vars
│  └─ package.json                  start / start:1 / start:2 / start:3 / start:all
├─ load-balancer/
│  ├─ server.js                     HTTP server, proxying, retry/failover
│  ├─ config.js                     loads + validates config.json, sensible defaults
│  ├─ config.json                   port, backends, algorithm, health check, retries, logging
│  ├─ backendServers.js             in-memory backend pool, built from config
│  ├─ healthChecker.js              background /health polling + UP/DOWN transitions
│  ├─ logger.js                     console + file logging, in-memory ring buffer
│  └─ algorithms/
│     ├─ index.js                   algorithm-name -> implementation lookup
│     ├─ roundRobin.js
│     └─ leastConnections.js
├─ logs/
│  └─ load-balancer.log             created at runtime (gitignored)
└─ verify-health-check.ps1          scripted failover proof (kill/restart backend-2)
```

`backend-server-1/`, `backend-server-2/`, `backend-server-3/` are leftovers from an
earlier iteration (one folder per backend, before `backend-server/` became a single
server driven by `SERVER_ID`/`PORT` env vars). They're superseded, excluded from git
via `.gitignore`, and can be deleted.

## Running it

Requires Node.js and npm.

```bash
# 1. install the one real dependency (Express, for the backend servers)
cd "backend-server"
npm install

# 2. start all three backends (backend-1:3001, backend-2:3002, backend-3:3003)
npm run start:all

# 3. in another terminal, start the load balancer (no install needed - core Node only)
cd "../load-balancer"
node server.js
```

The load balancer listens on `http://localhost:8080`. `GET /` proxies to a backend;
`GET /health` returns the load balancer's own aggregate view of the pool.

## Configuration (`load-balancer/config.json`)

```json
{
  "port": 8080,
  "backends": [
    { "id": "backend-1", "host": "127.0.0.1", "port": 3001 },
    { "id": "backend-2", "host": "127.0.0.1", "port": 3002 },
    { "id": "backend-3", "host": "127.0.0.1", "port": 3003 }
  ],
  "algorithm": "round-robin",
  "healthCheck": { "intervalMs": 5000, "timeoutMs": 1500 },
  "retryCount": 3,
  "log": { "filePath": "../logs/load-balancer.log", "level": "INFO" }
}
```

| Field                    | Meaning                                                                 | Default |
|---------------------------|--------------------------------------------------------------------------|---------|
| `port`                    | Port the load balancer listens on                                       | `8080` |
| `backends`                | Array of `{ id, host, port }` - the full backend pool                   | 3 local backends on 3001-3003 |
| `algorithm`               | Load-balancing algorithm by name: `"round-robin"` or `"least-connections"` | `"round-robin"` |
| `healthCheck.intervalMs`  | How often the background health checker polls every backend's `/health` | `5000` |
| `healthCheck.timeoutMs`   | How long a single health check waits before treating it as a failure    | `1500` |
| `retryCount`               | Max backends tried per client request (including the first try), further capped at the number of configured backends | `3` |
| `log.filePath`            | Log file path, resolved relative to `load-balancer/`                    | `../logs/load-balancer.log` |
| `log.level`               | Minimum level written/kept: `INFO`, `WARN`, or `ERROR`                  | `"INFO"` |

**Validation on startup:** `config.js` loads `config.json` once at process start. Any
missing file, malformed JSON, missing field, or invalid value (wrong type, out-of-range
port, unknown algorithm name, duplicate backend id, etc.) is replaced with its default
and logged as a `[config] ... - using default` warning to the console - the load
balancer never fails to start because of a bad config file.

## Load-balancing algorithms

**Round Robin** cycles through healthy backends in fixed order (1, 2, 3, 1, 2, 3, ...)
and never looks at how busy any of them currently are. **Least Connections** always
routes to whichever healthy backend has the fewest `activeConnections` right now, and
only falls back to round-robin ordering to break an exact tie.

That difference only shows up under **uneven request durations**. If every request
takes about the same time, both algorithms converge on the same even split, because
by the time the next request arrives the previous one is usually already done. But mix
in slow requests: Round Robin will still hand a busy backend its next request purely
because rotation says it's that backend's turn - it has no idea the backend is still
working on something else. Least Connections sees that backend's count is elevated and
routes around it until it frees up, so short requests keep landing on whichever backend
is actually free instead of queuing up behind a slow one.

Proof, captured live against this code: one slow request (`/work`, ~300ms) was sent to
backend-1, then six fast requests (`/`) were sent while it was still in flight.

```
=== ROUND ROBIN ===
backend-1 (busy with SLOW the whole time) got 2/6 of the fast burst

=== LEAST CONNECTIONS ===
backend-1 (busy with SLOW the whole time) got 0/6 of the fast burst
```

`activeConnections` is incremented the instant a request is forwarded to a backend and
decremented exactly once when that connection's outcome is known - on a normal response,
a backend error, a request timeout, or the client disconnecting early - so the count
never leaks even under failures or aborted requests.

### Switching algorithms at runtime (no restart)

The active algorithm can be changed live two ways, both logged as `ALGORITHM_SWITCH`:

- **API**: `GET /algorithm` returns the current algorithm and the supported list;
  `POST /algorithm` with `{"algorithm": "least-connections"}` switches it immediately.
  ```bash
  curl http://localhost:8080/algorithm
  curl -X POST -H "Content-Type: application/json" \
       -d '{"algorithm":"least-connections"}' http://localhost:8080/algorithm
  ```
- **Config file**: edit `algorithm` in `load-balancer/config.json` and save. The load
  balancer watches the file and picks up a valid new value within ~150ms - no restart,
  no API call needed.

An unsupported algorithm name (from either path) is rejected/ignored with a warning;
the load balancer keeps running the previously active algorithm.

### Adding a fourth backend

No code changes needed:

1. Start a fourth backend process (PowerShell):
   ```powershell
   cd backend-server
   $env:SERVER_ID="backend-4"; $env:PORT="3004"; node server.js
   ```
   (see `backend-server/package.json`'s `start:1`/`start:2`/`start:3` scripts for the `cmd`-based equivalent).
2. Add it to `load-balancer/config.json`:
   ```json
   { "id": "backend-4", "host": "127.0.0.1", "port": 3004 }
   ```
3. Restart the load balancer.

That's the whole change - `backendServers.js` builds its in-memory pool directly from
`config.backends`, so a fourth entry is a fourth backend in rotation.

## Logging

Every log line has the same shape: `[ISO timestamp] [LEVEL] message`, written to both
the console and `logs/load-balancer.log` simultaneously. Levels are `INFO`/`WARN`/`ERROR`;
`config.log.level` sets the minimum level that gets written anywhere (console, file, and
the in-memory buffer alike).

What gets logged, with the event tag each line starts with:

- `REQUEST` - every incoming request (method, path, client IP)
- `FORWARD` - which backend a request (or retry) was sent to
- `RESPONSE` - final status code and response time in ms for the whole request
- `HEALTHCHECK` / `HEALTHCHECK_CYCLE` - every health check result and each cycle's summary
- `TRANSITION` - every UP<->DOWN state change (WARN going down, INFO recovering)
- `RETRY` - a request-time failure and the immediate retry it triggers
- `FAILOVER_EXHAUSTED` - every healthy backend was tried and none worked (precedes the 503)
- `CLIENT_DISCONNECT` - the client closed the connection before a response was sent
- `ALGORITHM_SWITCH` - the active algorithm changed, and whether it came from the API or a config.json edit

`logger.getRecentLogs(limit)` also keeps the most recent 1000 entries in memory (subject
to the same level filter) for a future dashboard to read without re-parsing the log file.

## Postman collection

`postman/load-balancer.postman_collection.json` has two folders:

- **Proxy & Health (normal state)** - the proxy route, the load balancer's aggregate
  `/health`, and each backend's own `/health`, directly. Run this with the normal stack
  up (`npm run start:all` + `node server.js`).
- **Failure Scenario (requires all backends stopped)** - stop all three backend
  processes first (leave the load balancer running), then run this folder. It asserts
  the load balancer returns a clean `503` with a JSON `error` body instead of hanging.

Import the collection into Postman, or run it headlessly with
[Newman](https://www.npmjs.com/package/newman):

```bash
npx newman run postman/load-balancer.postman_collection.json --folder "Proxy & Health (normal state)"
# stop the backends, then:
npx newman run postman/load-balancer.postman_collection.json --folder "Failure Scenario (requires all backends stopped)"
```

## Scripted failover proof

`verify-health-check.ps1` starts the whole stack itself, kills `backend-2` mid-run,
waits for the load balancer to mark it dead, restarts it, and waits for it to rejoin -
printing the pool's state at each step. Run it standalone:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "verify-health-check.ps1"
```
