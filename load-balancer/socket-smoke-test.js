const { io } = require('socket.io-client');

const socket = io('http://localhost:8080', { transports: ['websocket', 'polling'] });

const ts = () => new Date().toISOString();

socket.on('connect', () => console.log(ts(), 'connected:', socket.id));
socket.on('pool:update', (data) => {
  const b2 = data.find((s) => s.id === 'backend-2');
  console.log(ts(), 'pool:update backend-2.isAlive=', b2 ? b2.isAlive : 'missing');
});
socket.on('log:new', (entry) => console.log(ts(), 'log:new', entry.message));
socket.on('connect_error', (err) => console.error(ts(), 'connect_error', err.message));

setTimeout(() => {
  socket.disconnect();
  process.exit(0);
}, 10000);
