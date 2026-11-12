// 아이폰 웹 푸시 발송. 구독 정보는 GitHub 비밀값 PUSH_SUBSCRIPTIONS(JSON 배열)에 있다.
import webpush from 'web-push';
import { readFileSync } from 'node:fs';

const subs = JSON.parse(process.env.PUSH_SUBSCRIPTIONS || '[]');
if (!subs.length) { console.log('구독 없음 → 푸시 생략'); process.exit(0); }
webpush.setVapidDetails('mailto:noreply@example.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

const s = JSON.parse(readFileSync('dist/summary.json', 'utf8'));
const lines = [];
const short = n => n.replace(/\(.*?\)|\[.*?\]/g, '').replace(/(입주자|잔여세대|추가|공공분양주택|본청약).*$/, '').trim().slice(0, 18);
if (s.star) lines.push(`⭐ ${s.starNames.slice(0, 2).map(short).join(', ')}`);
if (s.closingTodayNames?.length) lines.push(`⏰ 오늘 마감: ${s.closingTodayNames.slice(0, 2).map(short).join(', ')}${s.closingTodayNames.length > 2 ? ` 외 ${s.closingTodayNames.length - 2}` : ''}`);
if (s.topNames?.length) lines.push(`👍 나에게 맞는 순: ${s.topNames.slice(0, 2).map(short).join(', ')}`);
if (s.hotNames?.length) lines.push(`🔥 핫: ${s.hotNames.slice(0, 2).map(short).join(', ')}`);
lines.push(`접수 ${s.total}건 · 추천 ${s.recommend} · 조건부 ${s.conditional}`);
if (s.warnings) lines.push(`⚠️ 수집 경고 ${s.warnings}건`);
const payload = JSON.stringify({ title: '청약 레이더', body: lines.join('\n'), url: './' });

let ok = 0;
for (const sub of subs) {
  try { await webpush.sendNotification(sub, payload, { TTL: 6 * 3600, urgency: 'high' }); ok++; }
  catch (e) { console.error('푸시 실패', e.statusCode || e.message); }
}
console.log(`푸시 ${ok}/${subs.length}`);
