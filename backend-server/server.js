const express = require('express');

const port = Number(process.env.PORT || 3001);
const serverId = process.env.SERVER_ID || `backend-${port}`;
const app = express();

function logRequest(req) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${serverId} ${req.method} ${req.path}`);
}

app.use((req, res, next) => {
  logRequest(req);
  next();
});

app.get('/', (req, res) => {
  res.json({
    server: serverId,
    port,
    message: `Hello from ${serverId}`,
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    server: serverId,
    port,
    timestamp: new Date().toISOString()
  });
});

app.get('/work', (req, res) => {
  const delayMs = 300;

  setTimeout(() => {
    res.json({
      server: serverId,
      port,
      status: 'completed',
      work: 'processed',
      delayMs,
      timestamp: new Date().toISOString()
    });
  }, delayMs);
});

app.listen(port, () => {
  console.log(`${serverId} listening on http://localhost:${port}`);
});
