// 국토부 아파트 매매 실거래가 상세 + 분양권전매 → 주변 신축 시세
import { haversine } from './kakao.mjs';

const TRADE = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';
const SILV = 'https://apis.data.go.kr/1613000/RTMSDataSvcSilvTrade/getRTMSDataSvcSilvTrade';
const monthCache = new Map();

const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}>([^<]*)</${t}>`)); return m ? m[1].trim() : ''; };

async function month(base, key, lawd, ym) {
  const ck = `${base}|${lawd}|${ym}`;
  if (monthCache.has(ck)) return monthCache.get(ck);
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const u = `${base}?serviceKey=${encodeURIComponent(key)}&LAWD_CD=${lawd}&DEAL_YMD=${ym}&numOfRows=1000&pageNo=${page}`;
    const r = await fetch(u);
    if (!r.ok) throw new Error(`molit HTTP ${r.status}`);
    const xml = await r.text();
    const code = tag(xml, 'resultCode');
    if (code && code !== '000' && code !== '00') throw new Error(`molit ${code} ${tag(xml, 'resultMsg')}`);
    const items = xml.split('<item>').slice(1).map(s => ({
      apt: tag(s, 'aptNm'), umd: tag(s, 'umdNm'), jibun: tag(s, 'jibun'), sgg: tag(s, 'sggNm'),
      area: parseFloat(tag(s, 'excluUseAr')),
      price: parseInt(tag(s, 'dealAmount').replace(/,/g, ''), 10) * 10000,
      built: parseInt(tag(s, 'buildYear'), 10) || null,
      date: `${tag(s, 'dealYear')}-${tag(s, 'dealMonth').padStart(2, '0')}-${tag(s, 'dealDay').padStart(2, '0')}`,
      floor: parseInt(tag(s, 'floor'), 10) || null,
      canceled: !!tag(s, 'cdealType'),
    })).filter(x => x.price && !x.canceled);
    out.push(...items);
    if (items.length < 1000) break;
  }
  monthCache.set(ck, out);
  return out;
}

const recentMonths = (n, now = new Date()) => {
  const res = [];
  const kst = new Date(now.getTime() + 9 * 3600e3);
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() - i, 1));
    res.push(d.toISOString().slice(0, 7).replace('-', ''));
  }
  return res;
};

const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/**
 * 공급 위치(point)와 전용면적(area) 기준 비교 시세.
 * 반경 1km(부족하면 2km), 준공 10년 이내(분양권은 전부 신축), 면적 ±10㎡, 최근 6개월.
 * 결과는 ㎡당 중위가 × 대상 면적.
 */
export async function comparables({ key, kakao, point, lawd, area, months = 6, newTown = false }) {
  if (!lawd || !area) return { status: '불확실', reason: '위치 또는 면적 정보 없음' };
  const yms = recentMonths(months);
  const nowYear = new Date().getFullYear();
  // 신도시·택지지구 블록은 주변 구도심과 급지가 달라서 준공 5년 이내 + 분양권만 비교한다
  const maxAge = newTown ? 5 : 10;
  const pool = [];
  for (const ym of yms) {
    for (const t of await month(TRADE, key, lawd, ym)) if (t.built && t.built >= nowYear - maxAge) pool.push({ ...t, kind: '매매' });
    for (const t of await month(SILV, key, lawd, ym)) pool.push({ ...t, kind: '분양권' });
  }
  const sized = pool.filter(t => Math.abs(t.area - area) <= 10);
  // 단지별 좌표 (단지 수 많으면 거래 많은 순 25곳만)
  const groups = new Map();
  for (const t of sized) {
    const k = `${t.apt}|${t.umd}|${t.jibun}`;
    if (!groups.has(k)) groups.set(k, { apt: t.apt, umd: t.umd, jibun: t.jibun, sgg: t.sgg, trades: [] });
    groups.get(k).trades.push(t);
  }
  const ranked = [...groups.values()].sort((a, b) => b.trades.length - a.trades.length).slice(0, 25);
  for (const g of ranked) {
    try {
      const geo = await kakao.geocode(`${g.sgg} ${g.umd} ${g.jibun}`);
      g.m = geo ? haversine(point, geo) : null;
    } catch { g.m = null; }
  }
  for (const radius of [1000, 2000, 3000]) {
    const near = ranked.filter(g => g.m != null && g.m <= radius);
    const trades = near.flatMap(g => g.trades);
    if (trades.length >= 3) {
      // 거래 많은 한 단지가 시세를 끌고 가지 않게, 단지별 ㎡당 중위가를 구한 뒤 그 중위값을 쓴다
      const ppm = median(near.map(g => median(g.trades.map(t => t.price / t.area))));
      const complexes = near
        .map(g => ({ name: g.apt, m: g.m, n: g.trades.length, built: g.trades[0].built, kind: g.trades[0].kind,
                     median: median(g.trades.map(t => t.price)), latest: g.trades.sort((a, b) => b.date.localeCompare(a.date))[0] }))
        .sort((a, b) => a.m - b.m).slice(0, 5);
      return {
        status: trades.length >= 5 && near.length >= 2 ? '확인' : '표본 적음',
        radius, sample: trades.length, months, newTown, maxAge,
        estimate: Math.round((ppm * area) / 1e6) * 1e6,
        perPyeong: Math.round(ppm * 3.3058),
        complexes,
      };
    }
  }
  return { status: '불확실', reason: `반경 3km 안 준공 ${maxAge}년 이내${newTown ? '·분양권' : ''} 비슷한 면적 거래 3건 미만 (표본 ${sized.length})` };
}
