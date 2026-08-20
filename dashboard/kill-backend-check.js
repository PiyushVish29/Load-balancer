import { chromium } from 'playwright';
import { execSync } from 'child_process';

function killBackend2() {
  const psCmd = `Get-NetTCPConnection -LocalPort 3002 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`;
  execSync(`powershell -NoProfile -Command "${psCmd}"`);
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForSelector('text=backend-2', { timeout: 10000 });
  await page.waitForTimeout(1500);

  await page.screenshot({ path: 'kill-check-before.png', fullPage: true });
  console.log('BEFORE screenshot taken - all should be UP/green');

  const killedAt = Date.now();
  killBackend2();
  console.log('killed backend-2 at t=0ms');

  // Poll the DOM for backend-2's card to show DOWN, without ever reloading the page.
  let detectedAtMs = null;
  for (let i = 0; i < 100; i++) {
    const isDown = await page.evaluate(() => {
      const headings = Array.from(document.querySelectorAll('h3'));
      const card = headings.find((h) => h.textContent === 'backend-2')?.closest('div.rounded-xl');
      return card ? card.textContent.includes('DOWN') : false;
    });
    if (isDown) {
      detectedAtMs = Date.now() - killedAt;
      break;
    }
    await page.waitForTimeout(50);
  }

  await page.screenshot({ path: 'kill-check-after.png', fullPage: true });
  console.log('AFTER screenshot taken');
  console.log(detectedAtMs === null ? 'NEVER DETECTED within timeout' : `backend-2 card showed DOWN ${detectedAtMs}ms after kill (no page reload)`);
  console.log('console errors:', consoleErrors.length === 0 ? 'none' : consoleErrors.join('\n'));

  await browser.close();
})().catch((err) => {
  console.error('SCRIPT FAILED:', err);
  process.exit(1);
});
