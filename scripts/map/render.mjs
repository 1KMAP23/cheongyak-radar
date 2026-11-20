import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1100, height: 1300 }, deviceScaleFactor: 2 });
await p.goto('http://localhost:8080/wangsuk.html', { waitUntil: 'networkidle' }); await p.evaluate(() => window.READY);
await p.screenshot({ path: 'wangsuk-map.png' }); await b.close();
