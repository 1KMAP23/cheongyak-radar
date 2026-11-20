import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1100, height: 1300 }, deviceScaleFactor: 2 });
for (const [q, f] of [['', 'wangsuk-map.png'], ['?zoom=1', 'wangsuk-zoom.png']]) {
  await p.goto('http://localhost:8080/wangsuk.html' + q, { waitUntil: 'networkidle' }); await p.evaluate(() => window.READY);
  await p.screenshot({ path: f });
}
await b.close();
