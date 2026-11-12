// 매일 실행: 수집 → 분석 → dist/report.json (암호화 전 평문, dist는 커밋 안 함)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { collectApplyhome } from './collect/applyhome.mjs';
import { collectLH, crossCheck } from './collect/lh.mjs';
import { makeKakao } from './collect/kakao.mjs';
import { comparables } from './collect/molit.mjs';
import { eligibility, invest, commuteVerdict, overall, acquisitionTax, category, CATEGORY_LABEL, fitScore } from './analyze/judge.mjs';
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
const household = existsSync('config/household.json') ? JSON.parse(readFileSync('config/household.json', 'utf8')) : null;

const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const from = kstToday();
const to = new Date(Date.parse(from) + 9 * 864e5).toISOString().slice(0, 10);
const kakao = makeKakao(KAKAO);
const report = { generatedAt: new Date().toISOString(), range: { from, to }, hasHousehold: !!household, sources: {}, warnings: [], items: [] };

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
    if (geo) {
      out.location = await kakao.nearby(geo);
      out.commute = await kakao.commute(geo);
      // 평형별 시세 (서로 다른 전용면적 최대 3개)
      const sizes = [...new Map((it.models || []).filter(m => m.exclusiveArea && m.topPrice)
        .map(m => [Math.round(m.exclusiveArea), m])).values()]
        .sort((a, b) => Math.abs(a.exclusiveArea - 84) - Math.abs(b.exclusiveArea - 84)).slice(0, 3);
      out.market = [];
      for (const m of sizes) {
        const newTown = !geo.precise || /지구|블[록럭]|BL|택지|신도시/.test(`${it.address || ''} ${it.name}`);
        const comp = await comparables({ key: KEY, kakao, point: geo, lawd: geo.lawd, area: m.exclusiveArea, newTown });
        const tax = Math.round(acquisitionTax(m.topPrice));
        out.market.push({ type: m.type, area: Math.round(m.exclusiveArea * 10) / 10, pyeong: m.pyeong, price: m.topPrice, tax, comp,
          margin: comp.estimate ? comp.estimate - m.topPrice - tax : null });
      }
    }
  } catch (e) {
    out.analysisError = String(e.message || e);
  }
  out.eligibility = eligibility(it, household);
  out.invest = invest(it, { models: it.models, location: out.location, market: out.market });
  out.commuteResult = commuteVerdict(out.commute);
  out.overall = overall(out.eligibility, out.invest, out.commuteResult);
  try { out.buzz = await buzz(kakao, it); } catch (e) { out.buzz = null; }
  try { out.competition = await competition(KEY, it); } catch (e) { out.competition = null; }
  out.hot = hotLevel(out.buzz, out.competition);
  out.closingToday = it.window?.end === from;
  out.fit = fitScore(out);
  report.items.push(out);
}

// 정렬: ⭐ → 적합도 점수 → 마감 빠른 순 (오늘 마감 구역은 웹앱에서 맨 위로 따로 묶음)
report.items.sort((a, b) => (b.overall.star - a.overall.star) || (b.fit.total - a.fit.total) || (a.window?.end || '').localeCompare(b.window?.end || ''));
if (competitionStatus()) report.notices = [competitionStatus()];

const count = f => report.items.filter(f).length;
report.summary = {
  total: report.items.length,
  star: count(i => i.overall.star),
  recommend: count(i => i.invest.verdict === '추천'),
  conditional: count(i => i.invest.verdict === '조건부'),
  notRecommend: count(i => i.invest.verdict === '비추천'),
  closingToday: count(i => i.window?.end === from),
  starNames: report.items.filter(i => i.overall.star).map(i => i.name),
  hot: count(i => i.hot > 0),
  hotNames: report.items.filter(i => i.hot > 0).sort((a, b) => b.hot - a.hot || b.buzz.score - a.buzz.score).map(i => i.name),
  topNames: report.items.filter(i => i.eligibility.status !== '불가').slice(0, 3).map(i => i.name),
  closingTodayNames: report.items.filter(i => i.closingToday && i.eligibility.status !== '불가').map(i => i.name),
  recommendNames: report.items.filter(i => i.invest.verdict === '추천').map(i => i.name),
};

mkdirSync('dist', { recursive: true });
writeFileSync('dist/report.json', JSON.stringify(report));
// 세대 정보가 없을 때만 단지별 판정을 로그로 남긴다 (공개 로그에 세대 정보가 섞이지 않게)
if (!household) for (const i of report.items) {
  const m = i.market?.find(x => x.margin != null);
  if (m?.comp?.complexes) console.log(`    비교: ${m.comp.complexes.map(c => `${c.name}(${c.kind},${c.built},${c.m}m,${c.n}건,${(c.median / 1e8).toFixed(2)}억)`).join(' / ')} | lawd ${i.geo?.lawd} ${i.geo?.precise ? '' : '대략:' + i.geo?.query}`);
  console.log(`- [${i.invest.verdict}/${i.commuteResult.verdict}] ${i.name} | ${i.categoryLabel} | ${m ? `전용${m.area} 분양${(m.price / 1e8).toFixed(2)}억 시세${(m.comp.estimate / 1e8).toFixed(2)}억(${m.comp.radius}m,${m.comp.sample}건)` : (i.market?.[0]?.comp?.reason || '시세없음')} | 역 ${i.location?.subway?.[0] ? i.location.subway[0].name + ' ' + i.location.subway[0].m + 'm' : '-'} | 출퇴근 ${i.commute?.avg ?? '-'}분${i.analysisError ? ' | ERR ' + i.analysisError : ''}${i.geo ? '' : ' | 좌표없음'}`);
}
// 공개 로그에는 세대 정보가 들어가지 않게 개수만 출력
console.log(`화제성: ${report.items.map(i => `${i.buzz?.query}=${Math.round(i.buzz?.score ?? 0)}`).join(', ')}`);
console.log(`경쟁률: ${competitionStatus() || report.items.filter(i => i.competition?.field).map(i => `${i.buzz?.query} ${i.competition.field} ${i.competition.maxRate}`).join(', ') || '데이터 없음'}`);
console.log(`완료: ${report.items.length}건 (청약홈 ${ah.length}, LH 단독 ${onlyLH.length}) / 추천 ${report.summary.recommend} · 조건부 ${report.summary.conditional} · 비추천 ${report.summary.notRecommend} / 경고 ${report.warnings.length}`);
