const metrics = require('./metricsService');

(async () => {
  console.log('requestsPerServer:', await metrics.getRequestsPerServer());
  console.log('avgResponseTimePerServer:', await metrics.getAverageResponseTimePerServer());
  console.log('requestsPerAlgorithm:', await metrics.getRequestsPerAlgorithm());
  console.log('uptimePercentPerServer:', await metrics.getUptimePercentagePerServer());
  await metrics.disconnect();
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
