require('dotenv').config();
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

(async () => {
  const server = await prisma.server.upsert({
    where: { id: 'test-server' },
    update: { host: '127.0.0.1', port: 9999 },
    create: { id: 'test-server', host: '127.0.0.1', port: 9999 }
  });
  console.log('upserted:', server);
  const count = await prisma.server.count();
  console.log('server count:', count);
  await prisma.server.delete({ where: { id: 'test-server' } });
  await prisma.$disconnect();
  console.log('OK');
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
