# Load Balancer Dashboard

React + Vite + Tailwind CSS dashboard for the load balancer in `../load-balancer`.
Connects over Socket.IO for live backend/health/log/traffic updates and calls the load
balancer's `/api/*` REST endpoints for historical data on load. See the "Real-time
dashboard" section of the [root README](../README.md) for the full write-up.

## Running it

```bash
npm install
npm run dev
```

Requires the load balancer to already be running on `http://localhost:8080` (see the
root README). Override that URL with a `VITE_LB_URL` env var if needed.
