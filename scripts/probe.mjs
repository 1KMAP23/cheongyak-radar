import { collectRentals } from '../src/collect/rentals.mjs';
const from = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const r = await collectRentals({ key: process.env.DATA_GO_KR_KEY, from });
for (const it of r.items) console.log('ITEM', it.agency, it.rentalType, it.name, JSON.stringify(it.window), it.endUnknown ? '기간?' : '');
