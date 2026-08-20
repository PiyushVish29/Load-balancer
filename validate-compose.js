const fs = require('fs');
const yaml = require('js-yaml');
const path = require('path');

const composePath = path.join(__dirname, 'docker-compose.yml');
const doc = yaml.load(fs.readFileSync(composePath, 'utf8'));

console.log('YAML parsed OK.');
console.log('Services:', Object.keys(doc.services));
console.log('Volumes:', Object.keys(doc.volumes || {}));
console.log('Networks:', Object.keys(doc.networks || {}));

// Cross-check build contexts and referenced files actually exist.
const checks = [];
for (const [name, svc] of Object.entries(doc.services)) {
  if (svc.build) {
    const ctx = typeof svc.build === 'string' ? svc.build : svc.build.context;
    const ctxPath = path.join(__dirname, ctx);
    checks.push([`${name}: build context ${ctx}`, fs.existsSync(ctxPath)]);
    checks.push([`${name}: Dockerfile exists`, fs.existsSync(path.join(ctxPath, 'Dockerfile'))]);
  }
}

console.log('\n--- File existence checks ---');
let allOk = true;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`);
  if (!ok) allOk = false;
}

process.exit(allOk ? 0 : 1);
