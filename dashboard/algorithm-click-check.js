import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForSelector('text=Least Connections', { timeout: 10000 });
  await page.waitForTimeout(1000);

  const before = await page.textContent('body');
  console.log('Algorithm tile before click shows round-robin:', before.includes('round-robin'));

  await page.click('button:has-text("Least Connections")');
  await page.waitForTimeout(1000);

  await page.screenshot({ path: 'algorithm-click-after.png', fullPage: true });

  const after = await page.textContent('body');
  console.log('Algorithm tile after click shows least-connections:', after.includes('least-connections'));
  console.log('console errors:', consoleErrors.length === 0 ? 'none' : consoleErrors.join('\n'));

  await browser.close();
})().catch((err) => {
  console.error('SCRIPT FAILED:', err);
  process.exit(1);
});
