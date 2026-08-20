import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    consoleErrors.push('pageerror: ' + err.message);
  });

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForSelector('text=Load Balancer Dashboard', { timeout: 10000 });
  // give the socket connection + first tick a moment to populate cards
  await page.waitForTimeout(2000);

  await page.screenshot({ path: 'browser-check-screenshot.png', fullPage: true });

  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('--- BODY TEXT (first 2000 chars) ---');
  console.log(bodyText.slice(0, 2000));

  console.log('--- CONSOLE ERRORS ---');
  console.log(consoleErrors.length === 0 ? 'none' : consoleErrors.join('\n'));

  await browser.close();
})().catch((err) => {
  console.error('SCRIPT FAILED:', err);
  process.exit(1);
});
