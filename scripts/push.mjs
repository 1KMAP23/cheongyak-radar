// 아이폰 웹 푸시 발송.
// 1) 주인: GitHub 비밀값 PUSH_SUBSCRIPTIONS(JSON 배열) + dist/summary.json(HOUSEHOLD_JSON 기준)
// 2) 앱 사용자: dist/push-users.enc (운영자 시트에 동의한 사람별 요약 + 구독, SHEET_TOKEN으로 암호화)
import webpush from 'web-push';
import { readFileSync, existsSync } from 'node:fs';
import { createHash, createDecipheriv } from 'node:crypto';

webpush.setVapidDetails('mailto:noreply@example.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

// "(서울 중화) 중화역 라온프라이빗 센트로" → 지역 괄호는 살리고 뒤쪽 공고 문구만 줄인다
const short = n => { const m = n.match(/^(\([^)]*\))\s*(.*)$/); const head = m ? m[1] : ''; const body = (m ? m[2] : n).replace(/\(.*?\)|\[.*?\]/g, '').replace(/(입주자|잔여세대|추가|공공분양주택|본청약).*$/, '').trim().slice(0, 16); return `${head} ${body}`.trim(); };
function payload(s) {
  const lines = [];
  if (s.topNames?.length) lines.push(`👍 추천 순위: ${s.topNames.slice(0, 3).map((n, i) => `${i + 1}. ${short(n)}`).join(' ')}`);
  if (s.star) lines.push(`⭐ ${s.starNames.slice(0, 2).map(short).join(', ')}`);
  if (s.closingTodayNames?.length) lines.push(`⏰ 오늘 마감: ${s.closingTodayNames.slice(0, 2).map(short).join(', ')}${s.closingTodayNames.length > 2 ? ` 외 ${s.closingTodayNames.length - 2}` : ''}`);
  if (s.hotNames?.length) lines.push(`🔥 시세보다 2억+ 싼 곳: ${s.hotNames.slice(0, 2).map(short).join(', ')}`);
  lines.push(`접수 ${s.total}건 · 추천 ${s.recommend} · 조건부 ${s.conditional}`);
  if (s.warnings) lines.push(`⚠️ 수집 경고 ${s.warnings}건`);
  return JSON.stringify({ title: '청약 레이더', body: lines.join('\n'), url: './' });
}

const jobs = [];
const owner = JSON.parse(process.env.PUSH_SUBSCRIPTIONS || '[]');
if (owner.length && existsSync('dist/summary.json')) { const s = JSON.parse(readFileSync('dist/summary.json', 'utf8')); for (const sub of owner) jobs.push({ sub, s }); }
if (existsSync('dist/push-users.enc') && process.env.SHEET_TOKEN) {
  try {
    const e = JSON.parse(readFileSync('dist/push-users.enc', 'utf8'));
    const d = createDecipheriv('aes-256-gcm', createHash('sha256').update(process.env.SHEET_TOKEN).digest(), Buffer.from(e.iv, 'base64'));
    d.setAuthTag(Buffer.from(e.tag, 'base64'));
    const users = JSON.parse(Buffer.concat([d.update(Buffer.from(e.ct, 'base64')), d.final()]).toString());
    for (const u of users) jobs.push({ sub: u.sub, s: u.summary });
  } catch (err) { console.error('사용자 알림 파일 해독 실패', err.message); }
}
if (!jobs.length) { console.log('구독 없음 → 푸시 생략'); process.exit(0); }

// 같은 기기(endpoint)는 한 번만 (주인이 시트에도 있으면 시트 쪽 = 본인 설정 기준을 쓴다)
const byEndpoint = new Map();
for (const j of jobs) byEndpoint.set(j.sub.endpoint, j);
let ok = 0;
for (const { sub, s } of byEndpoint.values()) {
  try { await webpush.sendNotification(sub, payload(s), { TTL: 6 * 3600, urgency: 'high' }); ok++; }
  catch (e) { console.error('푸시 실패', e.statusCode || e.message); }
}
console.log(`푸시 ${ok}/${byEndpoint.size}`);
