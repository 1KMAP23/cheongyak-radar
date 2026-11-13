// 매일 실행: 수집 → 분석 → dist/report.json (암호화 전 평문, dist는 커밋 안 함)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash, createCipheriv, randomBytes } from 'node:crypto';
import { collectApplyhome } from './collect/applyhome.mjs';
import { collectLH, crossCheck } from './collect/lh.mjs';
import { makeKakao } from './collect/kakao.mjs';
import { comparables } from './collect/molit.mjs';
import { NON_APT } from '../web/lib/rules.js';
import { eligibility, invest, commuteVerdict, overall, acquisitionTax, category, CATEGORY_LABEL, fitScore, eligibilityTag, placeLabel, shortName, marginHot, TH } from './analyze/judge.mjs';
import { buzz, hotLevel } from './collect/buzz.mjs';
import { competition, competitionStatus } from './collect/competition.mjs';

function loadEnv() {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
loadEnv();

const KEY = process.env.DATA_GO_KR_KEY, KAKAO = process.env.KAKAO_REST_KEY;
if (!KEY || !KAKAO) { console.error('DATA_GO_KR_KEY / KAKAO_REST_KEY 필요'); process.exit(1); }
const WORKPLACES = JSON.parse(readFileSync('config/workplaces.json', 'utf8'));
const household = existsSync('config/household.json') ? JSON.parse(readFileSync('config/household.json', 'utf8')) : null;

// ── 앱 사용자(운영자 시트에 동의하고 보낸 사람) ──
// 직장 주소는 공개 데이터에 넣지 않고 익명 ID로만 쓴다 (web/household.js workplaceId와 같은 방식)
const workplaceId = a => 'w-' + createHash('sha256').update(String(a || '').replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 12);
let USERS = [];
if (process.env.SHEET_URL && process.env.SHEET_TOKEN) {
  try {
    const r = await fetch(`${process.env.SHEET_URL}?token=${encodeURIComponent(process.env.SHEET_TOKEN)}`, { redirect: 'follow' });
    const j = JSON.parse(await r.text());
    USERS = (j.users || []).filter(u => u.settings?.shareConsent);
  } catch (e) { console.log(`사용자 시트 읽기 실패: ${e.message}`); }
}
console.log(`앱 사용자: ${USERS.length}명 (알림 ${USERS.filter(u => u.push).length})`);

const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const from = kstToday();
const to = new Date(Date.parse(from) + 9 * 864e5).toISOString().slice(0, 10);
const kakao = makeKakao(KAKAO);
// 출퇴근을 계산할 직장: 공용 목록 + 사용자가 직접 넣은 주소 (최대 40곳)
const COMMUTE_WPS = [...WORKPLACES];
for (const u of USERS) {
  const addr = u.settings?.prefs?.workplaceAddress;
  if (!addr || COMMUTE_WPS.length >= 40) continue;
  const id = workplaceId(addr);
  if (COMMUTE_WPS.some(w => w.id === id)) continue;
  try { const g = await kakao.geocode(addr); if (g) COMMUTE_WPS.push({ id, x: g.x, y: g.y, private: true }); } catch {}
}
console.log(`출퇴근 계산 직장: ${COMMUTE_WPS.length}곳 (사용자 입력 ${COMMUTE_WPS.filter(w => w.private).length})`);
const report = { generatedAt: new Date().toISOString(), range: { from, to }, sources: {}, warnings: [], items: [] };

// ── 수집 ──
let ah = [], lh = [];
try { const r = await collectApplyhome({ key: KEY, from, to }); ah = r.items; report.sources.applyhome = { ok: true, ...r.stats }; }
catch (e) { report.sources.applyhome = { ok: false, error: String(e) }; report.warnings.push(`청약홈 수집 실패: ${e.message}`); }
try { const r = await collectLH({ key: KEY, from }); lh = r.items; report.sources.lh = { ok: true, ...r.stats }; }
catch (e) { report.sources.lh = { ok: false, error: String(e) }; report.warnings.push(`LH 수집 실패: ${e.message}`); }

const { onlyLH, matched } = crossCheck(ah, lh);
report.crossCheck = { lhTotal: lh.length, matched: matched.length, onlyLH: onlyLH.map(i => i.name) };
// LH 링크를 청약홈 항목에도 붙여 준다
for (const m of matched) {
  const hit = ah.find(a => a.name && m.name && (a.name.includes(m.name.slice(0, 6)) || m.name.includes(a.name.slice(0, 6))));
  if (hit) hit.lhUrl = m.noticeUrl;
}
const items = [...ah, ...onlyLH.map(i => ({ ...i, onlyLH: true }))];
// 주상복합 추정: 이름에 '주상복합'이 있거나, 같은 단지 이름·주소로 오피스텔이 같이 분양되는 아파트
const stem = n => String(n || '').replace(/\(.*?\)|\[.*?\]|\s|아파트|오피스텔|입주자모집공고|공고/g, '').slice(0, 6);
const offis = items.filter(i => i.propertyType === '오피스텔');
for (const it of items) {
  if (it.propertyType) continue;
  const twin = offis.find(o => (stem(o.name) && stem(o.name) === stem(it.name)) || (o.address && it.address && o.address.slice(0, 18) === it.address.slice(0, 18)));
  if (/주상복합/.test(`${it.name} ${it.address || ''}`)) it.mixedUse = '공고명에 주상복합';
  else if (twin) it.mixedUse = `같은 단지에서 오피스텔도 분양 (${twin.name})`;
}
// 오피스텔·생활숙박시설·주상복합(추정)은 목록에서 뺀다. 누락 확인용으로 이름은 로그와 보고서에 남김
const excluded = items.filter(i => i.propertyType === '오피스텔' || i.propertyType === '생활숙박시설' || i.mixedUse);
for (const x of excluded) items.splice(items.indexOf(x), 1);
console.log(`제외(오피스텔·생숙·주상복합): ${excluded.length}건${excluded.length ? ` (${excluded.map(x => `${x.name}[${x.propertyType || '주상복합'}]`).join(', ')})` : ''}`);

// ── 지난 업데이트 데이터 (배포된 암호화 파일) → 새로 생긴 공고 찾기 ──
async function previousIds() {
  const url = process.env.SITE_URL || 'https://1kmap23.github.io/cheongyak-radar/';
  try {
    const e = await (await fetch(`${url}data.enc.json?t=${Date.now()}`)).json();
    const b = x => Buffer.from(x, 'base64');
    const { webcrypto } = await import('node:crypto');
    const base = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(process.env.APP_PASSPHRASE || ''), 'PBKDF2', false, ['deriveKey']);
    const k = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', salt: b(e.salt), iterations: e.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const prev = JSON.parse(new TextDecoder().decode(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: b(e.iv) }, k, b(e.ct))));
    return { at: prev.generatedAt, ids: new Set(prev.items.map(i => i.id)) };
  } catch (err) { console.log(`지난 데이터 읽기 실패 → NEW 표시 안 함: ${err.message}`); return null; }
}
const PREV = await previousIds();
report.previousAt = PREV?.at || null;

// ── 분석 ──
for (const it of items) {
  const out = { ...it, category: category(it), categoryLabel: CATEGORY_LABEL[category(it)] };
  try {
    const scattered = /공가세대|매각/.test(it.name); // LH 공가 매각은 여러 단지에 흩어져 있어 위치 하나로 못 정함
    const geo = scattered ? null
      : it.address ? await kakao.geocode(it.address)
      : await kakao.geocode(it.name.replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/(입주자|잔여|추가|공공분양|신혼희망|본청약).*$/, '').trim());
    out.geo = geo;
    if (scattered) out.analysisNote = '여러 단지 공가 세대를 한꺼번에 파는 공고라 단지별 목록은 공고문에서 확인하세요.';
    if (geo && !geo.precise) out.analysisNote = `정확한 주소가 아니라 "${geo.query}" 기준 대략 위치로 분석했어요.`;
    if (NON_APT.has(out.category)) out.analysisNote = `${CATEGORY_LABEL[out.category]}은 아파트 실거래와 비교할 수 없어 안전마진을 계산하지 않아요.`;
    if (geo) {
      out.location = await kakao.nearby(geo);
      // 등록된 직장마다 출퇴근 예측 (앱에서 각자 고른 직장 기준으로 점수를 다시 계산한다)
      out.commutes = {};
      for (const wp of COMMUTE_WPS) out.commutes[wp.id] = await kakao.commute(geo, wp);
      // 평형별 시세: 59㎡·84㎡에 가장 가까운 주택형을 먼저, 남으면 하나 더 (서로 다른 전용면적 최대 3개)
      const uniq = [...new Map((it.models || []).filter(m => m.exclusiveArea && m.topPrice)
        .map(m => [Math.round(m.exclusiveArea), m])).values()];
      const near = t => uniq.slice().sort((a, b) => Math.abs(a.exclusiveArea - t) - Math.abs(b.exclusiveArea - t))[0];
      const sizes = [...new Set([near(84), near(59), ...uniq.sort((a, b) => Math.abs(a.exclusiveArea - 84) - Math.abs(b.exclusiveArea - 84))].filter(Boolean))].slice(0, 3);
      out.market = [];
      if (NON_APT.has(out.category)) sizes.length = 0;
      let pinnedKeys = null, pinnedOk = true;
      for (const m of sizes) {
        const newTown = !geo.precise || /지구|블[록럭]|BL|택지|신도시/.test(`${it.address || ''} ${it.name}`);
        const comp = await comparables({ key: KEY, kakao, point: geo, lawd: geo.lawd, area: m.exclusiveArea, newTown, name: shortName(it.name).replace(/ 잔여$/, ''), prefer: pinnedKeys, preferReliable: pinnedOk });
        if (!pinnedKeys && comp.keys && comp.method !== '같은 단지 실거래') { pinnedKeys = comp.keys; pinnedOk = comp.reliable !== false; }
        const tax = Math.round(acquisitionTax(m.topPrice));
        // 분양가에 빠져 있는 발코니 확장비 추정 (전용 ㎡당 20만원, 84㎡ 약 1,700만). 정확한 금액은 공고문 옵션표
        const balcony = Math.round(m.exclusiveArea * 2e5 / 1e5) * 1e5;
        const margin = comp.estimate ? comp.estimate - m.topPrice - tax - balcony : null;
        const ratio = comp.estimate ? comp.estimate / m.topPrice : null;
        // 이 평형 마진을 믿을 수 있나: 단지 간 편차, 시세/분양가 비율 0.6~1.6배
        const reliable = margin != null && comp.reliable !== false && ratio >= 0.6 && ratio <= 1.6;
        out.market.push({ type: m.type, area: Math.round(m.exclusiveArea * 10) / 10, pyeong: m.pyeong, price: m.topPrice, tax, balcony, comp, margin, reliable });
      }
    }
  } catch (e) {
    out.analysisError = String(e.message || e);
  }
  out.invest = invest(it, { models: it.models, location: out.location, market: out.market });
  try { out.buzz = await buzz(kakao, out); } catch (e) { out.buzz = null; }
  try { out.competition = await competition(KEY, it); } catch (e) { out.competition = null; }
  // 시장 반응으로 검산: 마진이 1억 넘게 나왔는데 경쟁률이 2:1도 안 되면 시세 추정이 과대했을 가능성이 크다
  const rate = out.competition?.maxRate;
  if (rate != null && rate < 2) for (const r of out.market || []) if (r.reliable && r.margin >= 1e8) {
    r.reliable = false; r.doubt = `경쟁률 최고 ${rate}:1로 낮음`;
    out.invest.marginReliable = false;
    out.invest.notes.push({ k: '시장 반응', v: `안전마진 ${Math.round(r.margin / 1e6) / 100}억으로 나왔지만 경쟁률이 최고 ${rate}:1뿐 → 브랜드·규모 차이로 시세가 과대 추정됐을 수 있어요`, s: 'bad' });
    if (out.invest.verdict === '추천') out.invest.verdict = '조건부';
  }
  // 🔥 핫 = 주변 시세보다 얼마나 싼가(안전마진). SNS 언급은 참고용(buzzLevel)으로만 쓴다
  const mh = marginHot(out.market);
  out.hot = mh.level; out.hotWhy = mh.why;
  out.buzzLevel = hotLevel(out.buzz, out.competition);
  out.closingToday = it.window?.end === from;
  out.isNew = PREV ? !PREV.ids.has(it.id) : false; // 지난 업데이트 이후 새로 생긴 공고
  out.place = placeLabel(out);
  out.shortName = shortName(it.name);
  report.items.push(out);
}

if (competitionStatus()) report.notices = [competitionStatus()];
// 분석 실패 감시: 위치를 찾은 공고 중 시세 분석이 깨진 게 많으면 앱 상단에 경고
const failed = report.items.filter(i => i.analysisError);
if (failed.length >= 3) report.warnings.push(`분석 오류 ${failed.length}건: ${failed[0].analysisError}`);
// 시세 검산 로그 (공공데이터로 만든 값만, 세대 정보 없음)
for (const i of report.items.filter(i => i.propertyType || i.mixedUse)) console.log(`유형 ${i.shortName}: ${i.propertyType || '주상복합 추정'} ${i.mixedUse || ''}`);
for (const i of report.items.filter(i => i.market?.length)) console.log(`시세 ${i.place}|${i.shortName}|🔥${i.hot}|${i.invest.verdict} ` + i.market.map(m => `${Math.round(m.area)}㎡ ${(m.price / 1e8).toFixed(2)}→${m.comp.estimate ? (m.comp.estimate / 1e8).toFixed(2) : '-'} 마진${m.margin != null ? (m.margin / 1e8).toFixed(2) : '-'}${m.reliable ? '' : '?'} n${m.comp.sample ?? 0} ${m.comp.method || ''}`).join(' / '));
console.log(`NEW: ${report.items.filter(i => i.isNew).map(i => i.shortName).join(', ') || '없음'} (지난 업데이트 ${report.previousAt || '-'})`);
console.log(`분석 오류: ${failed.length}건${failed.length ? ` (${failed[0].analysisError})` : ''}`);

// 아침 푸시 문구는 저장소 주인 세대(HOUSEHOLD_JSON) 기준. 이 판정 결과는 보고서에 넣지 않는다
// (비밀번호를 다른 사람과 공유하면 보고서를 열 수 있으므로, 세대 정보로 만든 내용은 각 기기에서 계산한다)
/** 한 세대 기준 아침 알림 요약 (앱 화면과 같은 규칙: web/lib/rules.js) */
// hh: 세대 정보(주인만 있음, 앱 사용자는 null) · prefs: 직장·지역·점수 비율
function summarize(hh, prefs = hh?.prefs) {
  const wpId = prefs?.workplaceId || prefs?.workplace || (prefs ? null : WORKPLACES[0]?.id);
  const regions = prefs?.regions;
  const view = report.items.filter(i => !regions?.length || regions.some(r => (i.region || '').startsWith(r))).map(i => {
    const v = { ...i, commute: wpId ? i.commutes?.[wpId] || null : null };
    v.eligibility = eligibility(v, hh, TH);
    v.commuteResult = commuteVerdict(v.commute);
    v.overall = overall(v.eligibility, v.invest, v.commuteResult);
    v.fit = fitScore(v, prefs?.weights);
    v.eligTag = eligibilityTag(v.eligibility);
    v.label = `(${i.place}) ${i.shortName}${v.eligTag?.icon === '❌' ? ' ❌' : ''}`;
    return v;
  }).sort((a, b) => b.fit.total - a.fit.total);
  const count = f => view.filter(f).length;
  return {
    total: view.length,
    star: count(i => i.overall.star),
    recommend: count(i => i.invest.verdict === '추천'),
    conditional: count(i => i.invest.verdict === '조건부'),
    notRecommend: count(i => i.invest.verdict === '비추천'),
    closingToday: count(i => i.closingToday),
    starNames: view.filter(i => i.overall.star).map(i => i.label),
    hot: count(i => i.hot > 0),
    hotNames: view.filter(i => i.hot > 0).sort((a, b) => (b.invest.margin || 0) - (a.invest.margin || 0)).map(i => i.label),
    topNames: view.slice(0, 3).map(i => i.label),
    closingTodayNames: view.filter(i => i.closingToday).map(i => i.label),
    recommendNames: view.filter(i => i.invest.verdict === '추천').map(i => i.label),
  };
}
// 아침 푸시: 저장소 주인 세대(HOUSEHOLD_JSON) + 동의한 사용자 각자 기준. 이 결과는 공유 보고서에 넣지 않는다
const pushSummary = summarize(household);
const userPush = USERS.filter(u => u.push?.endpoint).map(u => ({ sub: u.push, summary: summarize(u.settings, u.settings?.prefs || {}) }));
report.thresholds = TH;
report.workplaces = WORKPLACES.map(({ id, name }) => ({ id, name })); // 사용자 직장은 commutes의 익명 ID로만 존재
report.items.sort((a, b) => (a.window?.end || '').localeCompare(b.window?.end || ''));

mkdirSync('dist', { recursive: true });
writeFileSync('dist/report.json', JSON.stringify(report));
writeFileSync('dist/push-summary.json', JSON.stringify({ ...pushSummary, to: report.range.to, warnings: report.warnings.length }));
// 사용자별 알림(구독 정보 포함)은 SHEET_TOKEN으로 암호화해서 넘긴다 (작업 산출물은 공개 저장소에서 내려받을 수 있음)
if (userPush.length) {
  const key = createHash('sha256').update(process.env.SHEET_TOKEN).digest(), iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(userPush.map(u => ({ ...u, summary: { ...u.summary, warnings: report.warnings.length } })))), c.final()]);
  writeFileSync('dist/push-users.enc', JSON.stringify({ iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') }));
}
// 공개 로그에는 세대 정보가 들어가지 않게 개수만 출력
console.log(`화제성: ${report.items.map(i => `${i.buzz?.query}=${Math.round(i.buzz?.score ?? 0)}`).join(', ')}`);
console.log(`경쟁률: ${competitionStatus() || report.items.filter(i => i.competition?.field).map(i => `${i.buzz?.query} ${i.competition.field} ${i.competition.maxRate}`).join(', ') || '데이터 없음'}`);
console.log(`완료: ${report.items.length}건 (청약홈 ${ah.length}, LH 단독 ${onlyLH.length}) / 추천 ${pushSummary.recommend} · 조건부 ${pushSummary.conditional} · 비추천 ${pushSummary.notRecommend} / 경고 ${report.warnings.length}`);
