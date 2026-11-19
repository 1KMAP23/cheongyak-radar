// 특정 공고 하나를 즉석 분석 (디버그용): PROBE_NAME 포함 공고의 주택형·분양가, 위치, 출퇴근, 평형별 주변 시세
import { collectApplyhome } from '../src/collect/applyhome.mjs';
import { comparables } from '../src/collect/molit.mjs';
import { makeKakao, CHURCH } from '../src/collect/kakao.mjs';
const key = process.env.DATA_GO_KR_KEY, kakao = makeKakao(process.env.KAKAO_REST_KEY), q = process.env.PROBE_NAME;
const from = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const { items } = await collectApplyhome({ key, from, sinceDays: 120, log: () => {} });
let hits = items.filter(i => (i.name || '').replace(/\s/g, '').includes(q.replace(/\s/g, '')));
// API에 아직 없으면 주소·면적으로 직접 분석 (PROBE_ADDR, PROBE_AREAS=59,79,84)
if (!hits.length && process.env.PROBE_ADDR) hits = [{ name: q, address: process.env.PROBE_ADDR, models: (process.env.PROBE_AREAS || '59,84').split(',').map(a => ({ type: a, exclusiveArea: +a })) }];
console.log('HITS', hits.length);
for (const it of hits) {
  console.log('ITEM', JSON.stringify({ name: it.name, category: it.category, address: it.address, window: it.window, schedule: it.schedule, flags: it.flags, totalUnits: it.totalUnits, moveIn: it.moveIn, builder: it.builder, noticeDate: it.noticeDate, url: it.noticeUrl }));
  for (const m of it.models || []) console.log('MODEL', m.type, m.exclusiveArea, m.topPrice, 'g', m.general, 's', m.special);
  const geo = await kakao.geocode(it.address);
  console.log('GEO', JSON.stringify(geo));
  if (!geo) continue;
  const c = await kakao.commute(geo, CHURCH); console.log('COMMUTE', JSON.stringify(c));
  const near = await kakao.nearby(geo); console.log('NEAR', JSON.stringify({ subway: near.subway?.slice(0, 2), elementary: near.elementary?.slice(0, 1), academies1km: near.academies1km, commerce: near.commerce }));
  const areas = [...new Set((it.models || []).map(m => Math.round(m.exclusiveArea)))];
  for (const a of [...new Set([...areas, 59, 84])]) {
    const r = await comparables({ key, kakao, point: geo, lawd: geo.lawd, area: a, name: it.name });
    console.log('COMP', a, JSON.stringify({ status: r.status, est: r.estimate, method: r.method, sample: r.sample, spread: r.spread, radius: r.radius, complexes: r.complexes }));
  }
}
