// Belt-and-suspenders database wait, run before migrations at container
// startup. docker-compose's `depends_on: postgres: condition: service_healthy`
// already keeps this container from starting until Postgres's own healthcheck
// passes, but this adds an application-level check too - in case that
// container ever runs outside compose's orchestration, or Postgres reports
// healthy just as it's still finishing first-time initialization.
const { Client } = require('pg');

const MAX_ATTEMPTS = 30;
const DELAY_MS = 2000;

async function waitForDb() {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await client.connect();
      await client.end();
      console.log(`[wait-for-db] database reachable after ${attempt} attempt(s)`);
      return;
    } catch (error) {
      console.log(`[wait-for-db] attempt ${attempt}/${MAX_ATTEMPTS} failed: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
  }
  // Don't block startup forever - metricsService already degrades gracefully
  // (fire-and-forget writes, 503 on aggregate reads) if the database never
  // shows up, matching the same "a database failure must not take down the
  // proxy" guarantee the app already provides at runtime.
  console.error(`[wait-for-db] database still unreachable after ${MAX_ATTEMPTS} attempts - starting anyway, metrics will degrade gracefully`);
}

waitForDb();
