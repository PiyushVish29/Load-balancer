# Mini Load Balancer

A small, dependency-light HTTP load balancer written in plain Node.js. It round-robins
(or least-connections) traffic across a configurable pool of backend servers,
health-checks them in the background, automatically fails a request over to the next
healthy backend when one dies mid-request, logs every request, health check, and
failover event to console and to a log file, persists that same activity to PostgreSQL
(async, non-blocking), and streams all of it live to a React dashboard over Socket.IO.

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
├─ docker-compose.yml               wires all six containers on one network
├─ .gitattributes                   forces LF endings for .sh/Dockerfile (Windows checkouts)
├─ postman/
│  └─ load-balancer.postman_collection.json
├─ backend-server/                  the backend used by every instance
│  ├─ server.js                     reads SERVER_ID / PORT from env vars
│  ├─ package.json                  start / start:1 / start:2 / start:3 / start:all
│  ├─ Dockerfile
│  └─ .dockerignore
├─ load-balancer/
│  ├─ server.js                     HTTP server, proxying, retry/failover, REST /api/*, CORS
│  ├─ config.js                     loads + validates config.json, sensible defaults
│  ├─ config.json                   local dev config - backends at 127.0.0.1
│  ├─ config.docker.json            same shape, backends at container names (backend-1, ...)
│  ├─ backendServers.js             in-memory backend pool, built from config
│  ├─ healthChecker.js              background /health polling + UP/DOWN transitions
│  ├─ logger.js                     console + file logging, in-memory ring buffer
│  ├─ eventBus.js                   in-process pub/sub - the only thing socketServer.js listens to
│  ├─ statsTracker.js               in-memory global request/RPS/avg-response-time counters
│  ├─ socketServer.js               Socket.IO server - live pool/stats/log/request/algorithm events
│  ├─ metricsService.js             async Postgres persistence + dashboard aggregate queries
│  ├─ prisma.config.ts              Prisma CLI config (migrations) - reads DATABASE_URL
│  ├─ prisma/
│  │  ├─ schema.prisma              Server / RequestRecord / HealthEvent models
│  │  └─ migrations/
│  ├─ docker/
│  │  ├─ docker-entrypoint.sh       wait for db -> migrate deploy -> start server
│  │  └─ wait-for-db.js             connection-retry loop against DATABASE_URL
│  ├─ Dockerfile
│  ├─ .dockerignore                 excludes .env - real secrets never enter the image
│  ├─ .env                          DATABASE_URL (gitignored - see .env.example)
│  └─ algorithms/
│     ├─ index.js                   algorithm-name -> implementation lookup
│     ├─ roundRobin.js
│     └─ leastConnections.js
├─ dashboard/                       React + Vite + Tailwind live dashboard (see below)
│  ├─ Dockerfile                    multi-stage: vite build -> served by nginx:alpine
│  ├─ nginx.conf
│  ├─ .dockerignore
│  └─ src/
│     ├─ hooks/useDashboard.js      the one Socket.IO connection + all live state
│     ├─ api.js                    REST calls for historical/seed data
│     └─ components/                BackendCard, GlobalStats, charts, LogPanel, AlgorithmControl
├─ logs/
│  └─ load-balancer.log             created at runtime (gitignored)
└─ verify-health-check.ps1          scripted failover proof (kill/restart backend-2)
```

`backend-server-1/`, `backend-server-2/`, `backend-server-3/` are leftovers from an
earlier iteration (one folder per backend, before `backend-server/` became a single
server driven by `SERVER_ID`/`PORT` env vars). They're superseded, excluded from git
via `.gitignore`, and can be deleted.

## Running it with Docker

The fastest path - everything on one network, one command, on a clean machine with
nothing but Docker installed:

```bash
docker compose up --build
```

This builds and starts six containers: `postgres`, `backend-1`/`backend-2`/`backend-3`
(all from the same image, distinguished only by `SERVER_ID`/`PORT` env vars),
`load-balancer`, and `dashboard`. Once it settles:

- Dashboard: `http://localhost:5173`
- Load balancer: `http://localhost:8080`
- Backends are **not** published to the host - only reachable from other containers on
  the compose network, exactly like a real deployment where only the load balancer is
  internet-facing.

### How the pieces fit together

- **One shared network** (`lb-network`, a plain bridge network defined in
  `docker-compose.yml`) - Compose gives every service DNS resolution by its service
  name on that network, so the load balancer reaches backends at `http://backend-1:3001`
  etc., never `localhost`. That's what `load-balancer/config.docker.json` points at
  (vs. `config.json`'s `127.0.0.1` for local dev) - selected via a `CONFIG_PATH` env var
  the Dockerfile sets, so local dev's `config.json` is untouched either way.
- **The database dependency is enforced twice.** `docker-compose.yml` gives `postgres`
  a real healthcheck (`pg_isready`) and makes `load-balancer` `depends_on: postgres:
  condition: service_healthy` - Compose won't even *start* that container until
  Postgres is accepting connections. On top of that, the load balancer's own
  `docker/docker-entrypoint.sh` runs `docker/wait-for-db.js` (a small connection-retry
  loop using the `pg` package directly) before running `prisma migrate deploy` to create
  the schema in the fresh database, and only then starts `node server.js`. Belt and
  suspenders: the compose-level gate is what actually matters, the app-level wait covers
  the container ever being run outside Compose's orchestration.
- **Every service has its own healthcheck**, baked into its Dockerfile (`HEALTHCHECK`)
  rather than duplicated in the compose file: the backends and load balancer check their
  own `/health` endpoint, the dashboard checks nginx is serving. `docker compose ps`
  shows real health, not just "container running."
- **Postgres data survives `docker compose down`** via the named volume `pgdata` -
  only `docker compose down -v` (or deleting the volume explicitly) wipes it.
- **The dashboard is a static build**, not a dev server: a multi-stage Dockerfile runs
  `npm run build` and serves the output through `nginx:alpine`. `VITE_LB_URL` is a build
  `ARG` (Vite inlines env vars at build time) - it stays `http://localhost:8080` by
  default because the *browser*, not another container, is what connects to the load
  balancer; a container-name URL would never resolve there.
- **Migrations run automatically** the first time (`prisma migrate deploy` applies
  everything under `load-balancer/prisma/migrations/`) - no manual `npm run db:migrate`
  step, unlike the local-dev path below.

Useful commands:

```bash
docker compose logs -f load-balancer   # tail one service's logs
docker compose down                    # stop everything, keep the postgres volume
docker compose down -v                 # stop everything and wipe postgres data too
docker compose up --build backend-1    # rebuild/restart just one service
```

> **Note on this repo's own verification:** this Dockerization was written and
> cross-checked (YAML parsed, every `COPY`/build-context path confirmed to exist,
> `npm ci`/`prisma generate`/`prisma migrate deploy` all independently verified to work
> against the actual package-lock files and migrations) in an environment with no Docker
> daemon available and no admin rights to install one. It was not possible to actually
> run `docker compose up` end-to-end here - please run it yourself and report back if
> anything doesn't come up cleanly.

## Running it locally (no Docker)

Requires Node.js, npm, and a running PostgreSQL instance (only needed for metrics -
see below; the proxy itself works without it).

```bash
# 1. install the one real backend dependency (Express)
cd "backend-server"
npm install

# 2. start all three backends (backend-1:3001, backend-2:3002, backend-3:3003)
npm run start:all

# 3. in another terminal: install the load balancer's dependencies (this also
#    runs `prisma generate` via postinstall) and point it at your database
cd "../load-balancer"
npm install
cp .env.example .env   # edit DATABASE_URL if your Postgres setup differs
npm run db:migrate     # creates loadbalancer_metrics tables (prompts for a migration name only if the schema changed)

# 4. start the load balancer
node server.js

# 5. in a third terminal: the dashboard
cd "../dashboard"
npm install
npm run dev
```

The load balancer listens on `http://localhost:8080`. `GET /` proxies to a backend;
`GET /health` returns the load balancer's own aggregate view of the pool. The dashboard
runs on `http://localhost:5173` and talks to the load balancer over Socket.IO + REST -
open it in a browser once both are up.

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
to the same level filter) - the dashboard's log panel reads from this, both as a REST
snapshot on load and streamed live over Socket.IO after that.

## PostgreSQL metrics (Prisma)

Every request, health-check transition, and the backend registry itself are persisted
to PostgreSQL via Prisma, queried by the dashboard's charts and REST endpoints.
**Persistence is entirely decoupled from request forwarding**: the proxy works exactly
the same whether the database is healthy, slow, or completely unreachable.

### Schema (`load-balancer/prisma/schema.prisma`)

- **`Server`** - the backend registry (`id`, `host`, `port`). Kept in sync with
  `config.json`'s `backends` list on every startup (upserted, so removed backends are
  left in place rather than deleted - their historical rows stay valid).
- **`RequestRecord`** - one row per client request: `timestamp`, `serverId` (nullable -
  null for a request that got a 503 with no backend involved), `path`, `method`,
  `statusCode`, `responseTimeMs`, `algorithm`.
- **`HealthEvent`** - one row per UP<->DOWN transition (not every poll - only actual
  state changes, same as the logger's `TRANSITION` lines): `serverId`, `oldStatus`,
  `newStatus`, `timestamp`.

### Why writes can't slow down or break the proxy

`metricsService.js`'s write functions (`recordRequest`, `recordHealthEvent`,
`syncServerRegistry`) are **fire-and-forget**: the load balancer calls them and moves
on immediately without `await`ing the result. Each call attaches its own `.catch()`, so
a failed write - slow database, connection refused, whatever - is logged as
`METRICS_WRITE_FAILED` (or `METRICS_REGISTRY_SYNC_FAILED` at startup) and dropped; it
never throws back into the request path. If the Prisma client can't even be constructed
(missing/invalid `DATABASE_URL`), metrics are disabled entirely at startup
(`METRICS_DISABLED`) and every write function becomes a no-op - the rest of the load
balancer is unaffected either way.

Verified live: with `DATABASE_URL` pointed at an unreachable port (simulating the
database being down), the load balancer still started immediately, `/health` and `/`
kept returning correct responses in single-digit milliseconds, and every dropped write
showed up as a `METRICS_WRITE_FAILED` log line. Once the database became reachable
again, writes resumed on their own - no restart needed.

### Aggregate queries (for the dashboard)

Unlike the writes above, these ARE awaited by whatever calls them - a dashboard request
is fine to wait on, it just isn't on the hot request-forwarding path.

- `getRequestsPerServer()` - request count grouped by backend
- `getAverageResponseTimePerServer()` - average `responseTimeMs` grouped by backend
- `getRequestsPerAlgorithm()` - request count grouped by algorithm
- `getUptimePercentagePerServer()` - for each server, walks its `HealthEvent` rows in
  order and sums how long it held `UP` vs `DOWN` between consecutive events (the last
  segment runs to now). Returns `null` for a server with no recorded transitions yet -
  uptime is only meaningful from when tracking started.
- `getRecentRequests(limit)` - raw recent `RequestRecord` rows, oldest first; used to
  seed the dashboard's charts with history on page load.

### Setup notes

- Uses Prisma 7's driver-adapter model (`@prisma/adapter-pg`), which moved the
  connection string out of `schema.prisma` and into `prisma.config.ts` (for the CLI) and
  an explicit `PrismaPg` adapter passed to `new PrismaClient({ adapter })` (for the
  app) - both read `DATABASE_URL` from `.env`.
- `npm run db:migrate` wraps `prisma migrate dev`; `npm run db:studio` opens Prisma
  Studio if you want to browse the tables directly.

## Real-time dashboard

`dashboard/` is a React + Vite + Tailwind app (Tailwind only - no component library)
that shows the pool live: a card per backend (id, port, UP/DOWN, active connections,
total requests, average response time), global stats (total requests, requests/sec,
overall average response time, active algorithm), two live Recharts time-series
(requests per server, response time per server, both bucketed client-side by second),
a streaming log panel, and Round Robin / Least Connections buttons.

### How it stays live

One Socket.IO connection, one custom hook (`useDashboard.js`) - everything else in the
UI is presentational. The load balancer's `socketServer.js` attaches Socket.IO to the
*same* HTTP server `server.js` already listens with (no second port), and is the sole
subscriber of `eventBus.js`, an in-process `EventEmitter` that `logger.js`,
`healthChecker.js`, and `server.js` already emit domain events on for their own
reasons - the socket layer just listens in, so none of those modules know or care that
Socket.IO exists.

| Event | Fired when | Payload |
|---|---|---|
| `pool:update` | A health transition happens (instantly), and once a second otherwise | Full backend array, incl. `avgResponseTimeMs` |
| `stats:update` | Once a second, and right after an algorithm switch | `{ totalRequests, requestsPerSecond, avgResponseTimeMs, algorithm }` |
| `log:new` | Every log line, the instant it's written | `{ timestamp, level, message }` |
| `request:new` | Every completed proxied request | `{ backend, path, method, statusCode, responseTimeMs, algorithm, timestamp }` |
| `algorithm:changed` | The active algorithm changes (API or config file) | `{ from, to, source }` |
| `logs:initial` | Once, right after a client connects | Last 200 log entries |

A newly-connected dashboard gets `pool:update`/`stats:update`/`logs:initial` immediately
on connect, so it's never blank waiting for the next event.

REST endpoints (all on the load balancer, CORS-enabled, all backed by
`metricsService.js`'s aggregate queries so a database outage 503s cleanly instead of
hanging the dashboard) exist for the data Socket.IO doesn't carry - history from before
the page loaded:

- `GET /api/metrics/requests-per-server`
- `GET /api/metrics/avg-response-time-per-server`
- `GET /api/metrics/requests-per-algorithm`
- `GET /api/metrics/uptime-per-server`
- `GET /api/metrics/recent-requests?limit=N` - seeds the two charts
- `GET /api/logs/recent?limit=N` - seeds the log panel (redundant with `logs:initial`,
  kept as a fallback and for refreshing just that panel)
- `GET /algorithm` / `POST /algorithm` (pre-existing, documented above) - what the
  Round Robin / Least Connections buttons call

Chart history is bucketed by second entirely client-side (the backend just streams raw
`request:new` events - it doesn't do time-series aggregation itself), merged into the
same keyed series whether the data came from the initial REST seed or a live tick, so
neither path can silently overwrite the other's data.

### Verified: instant, no refresh

Screenshotted end-to-end with backend-2 killed mid-session (same browser tab, never
reloaded): its card flips from a green "UP" badge to a red "DOWN" badge, and the log
panel shows the `TRANSITION`/`HEALTHCHECK` lines explaining why, live. Detection speed
depends on how the failure was noticed:

- **With live traffic flowing**: a request hits the dead backend, the load balancer's
  existing failover logic marks it dead immediately, and `pool:update` reaches the
  dashboard **~1ms** later (measured with a raw Socket.IO client and millisecond
  timestamps around an actual kill).
- **With no traffic** (dashboard-only viewing): detection waits for the next periodic
  health check, bounded by `config.healthCheck.intervalMs` (default 5000ms) - still
  fully automatic, still no page refresh, just not sub-millisecond.

Either way, nothing about the dashboard changes - it just reacts to whichever
`healthTransition` event the backend happens to emit.

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
