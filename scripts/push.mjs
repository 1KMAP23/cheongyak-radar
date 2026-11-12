// 아이폰 웹 푸시 발송. 구독 정보는 GitHub 비밀값 PUSH_SUBSCRIPTIONS(JSON 배열)에 있다.
import webpush from 'web-push';
import { readFileSync } from 'node:fs';

const subs = JSON.parse(process.env.PUSH_SUBSCRIPTIONS || '[]');
if (!subs.length) { console.log('구독 없음 → 푸시 생략'); process.exit(0); }
webpush.setVapidDetails('mailto:noreply@example.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

const s = JSON.parse(readFileSync('dist/summary.json', 'utf8'));
const lines = [];
if (s.star) lines.push(`⭐ ${s.starNames.slice(0, 2).join(', ')}`);
else if (s.recommend) lines.push(`투자 추천: ${s.recommendNames.slice(0, 2).join(', ')}`);
lines.push(`오늘~${s.to.slice(5).replace('-', '/')} 접수 ${s.total}건 · 추천 ${s.recommend} · 조건부 ${s.conditional}${s.closingToday ? ` · 오늘 마감 ${s.closingToday}` : ''}`);
if (s.warnings) lines.push(`⚠️ 수집 경고 ${s.warnings}건`);
const payload = JSON.stringify({ title: '청약 레이더', body: lines.join('\n'), url: './' });

let ok = 0;
for (const sub of subs) {
  try { await webpush.sendNotification(sub, payload, { TTL: 6 * 3600, urgency: 'high' }); ok++; }
  catch (e) { console.error('푸시 실패', e.statusCode || e.message); }
}
console.log(`푸시 ${ok}/${subs.length}`);
