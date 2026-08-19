import { chromium } from 'playwright-core';

async function shot(theme, out) {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:3000/?theme=${theme}`, {
    waitUntil: 'networkidle',
    timeout: 30000
  });
  await page.waitForSelector('.project-card .card-title', { timeout: 15000 });
  await page.waitForTimeout(2000);
  const themeAttr = await page.getAttribute('html', 'data-theme');
  const titles = await page.$$eval('.project-card .card-title', (els) =>
    els.map((e) => e.textContent.trim())
  );
  console.log(theme, 'data-theme=', themeAttr, 'count=', titles.length);
  console.log('titles=', titles.join(' | '));
  await page.screenshot({ path: out, fullPage: false });
  await browser.close();
}

await shot('light', '/tmp/portal-shots/light.png');
await shot('dark', '/tmp/portal-shots/dark.png');
console.log('done');
