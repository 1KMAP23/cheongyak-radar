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
      direct: /직거래/.test(tag(s, 'dealingGbn')),           // 가족 간 저가 거래가 섞일 수 있어 뺀다
      ticket: /입/.test(tag(s, 'ownershipGbn')),             // 입주권(조합원)은 추가분담금 때문에 가격이 왜곡돼 뺀다
    })).filter(x => x.price && !x.canceled && !x.direct && !x.ticket);
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

const norm = s => String(s || '').replace(/\(.*?\)|\[.*?\]|아파트|\s/g, '');

/** 주변 시군구까지 같이 본다: 공급 위치에서 동서남북 2.5km 지점의 시군구 코드 */
async function nearbyLawds(kakao, point, lawd) {
  const set = new Set([lawd]);
  if (!kakao.region) return [...set];
  const d = 2500 / 111000;
  for (const [dx, dy] of [[d / Math.cos(point.y * Math.PI / 180), 0], [-d / Math.cos(point.y * Math.PI / 180), 0], [0, d], [0, -d]]) {
    try { const r = await kakao.region(point.x + dx, point.y + dy); if (r?.lawd) set.add(r.lawd); } catch {}
  }
  return [...set];
}

/**
 * 공급 위치(point)와 전용면적(area) 기준 비교 시세.
 * 1) 같은 단지 거래(분양권·매매)가 3건 이상이면 그걸로 (가장 정확)
 * 2) 아니면 3km 안에서 가까운 단지 순으로: 1km 안에 3곳 이상이면 1km 안 최대 5곳, 아니면 가장 가까운 3곳
 *    거래 2건 이상 단지를 우선 (1건짜리는 나홀로·특이 거래일 가능성)
 * 단지별 ㎡당 중위가의 중위값 × 대상 면적. 단지 간 ㎡당 가격 차이가 1.7배를 넘으면 '편차 큼'으로 신뢰도 낮음.
 * 매매는 준공 10년 이내(신도시 5년), 직거래·해제·입주권 제외, 최근 6개월, 면적 ±8㎡.
 */
export async function comparables({ key, kakao, point, lawd, area, months = 6, newTown = false, name = '', prefer = null }) {
  if (!lawd || !area) return { status: '불확실', reason: '위치 또는 면적 정보 없음' };
  const yms = recentMonths(months);
  const nowYear = new Date().getFullYear();
  const maxAge = newTown ? 5 : 10;
  const lawds = await nearbyLawds(kakao, point, lawd);
  const pool = [];
  for (const ld of lawds) for (const ym of yms) {
    for (const t of await month(TRADE, key, ld, ym)) if (t.built && t.built >= nowYear - maxAge) pool.push({ ...t, kind: '매매' });
    for (const t of await month(SILV, key, ld, ym)) pool.push({ ...t, kind: '분양권' });
  }
  const sized = pool.filter(t => Math.abs(t.area - area) <= 8);
  const groups = new Map();
  for (const t of sized) {
    const k = `${t.apt}|${t.umd}|${t.jibun}|${t.kind}`;
    if (!groups.has(k)) groups.set(k, { apt: t.apt, umd: t.umd, jibun: t.jibun, sgg: t.sgg, kind: t.kind, trades: [] });
    groups.get(k).trades.push(t);
  }
  const ranked = [...groups.values()].sort((a, b) => b.trades.length - a.trades.length).slice(0, 80);
  for (const g of ranked) {
    try { const geo = await kakao.geocode(`${g.sgg} ${g.umd} ${g.jibun}`); g.m = geo ? haversine(point, geo) : null; } catch { g.m = null; }
    g.ppm = median(g.trades.map(t => t.price / t.area));
  }
  const geoed = ranked.filter(g => g.m != null && g.m <= 3000).sort((a, b) => a.m - b.m);
  const me = norm(name);
  const isSelf = g => g.m <= 400 && me.length >= 4 && (norm(g.apt).includes(me.slice(0, 6)) || me.includes(norm(g.apt).slice(0, 6)));
  const self = geoed.filter(isSelf);
  let use, method;
  const keyOf = g => `${g.apt}|${g.umd}|${g.jibun}|${g.kind}`;
  // 같은 공고의 다른 평형과 비교 단지를 맞춘다 (평형마다 이웃이 달라지면 ㎡당 가격이 들쭉날쭉해진다)
  const pinned = prefer ? geoed.filter(g => prefer.includes(keyOf(g))) : [];
  if (self.reduce((s, g) => s + g.trades.length, 0) >= 3) { use = self; method = '같은 단지 실거래'; }
  else if (pinned.length >= 2 && pinned.reduce((s, g) => s + g.trades.length, 0) >= 3) { use = pinned; method = '다른 평형과 같은 비교 단지'; }
  else {
    const others = geoed.filter(g => !isSelf(g));
    const solid = others.filter(g => g.trades.length >= 2);
    const base = solid.length >= 2 ? solid : others;
    const in1 = base.filter(g => g.m <= 1000);
    use = in1.length >= 3 ? in1.slice(0, 5) : base.slice(0, 3);
    method = in1.length >= 3 ? '1km 안 단지' : '가까운 단지 3곳';
  }
  const trades = use.flatMap(g => g.trades);
  if (trades.length < 3) return { status: '불확실', reason: `반경 3km 안 준공 ${maxAge}년 이내·분양권 비슷한 면적 거래 3건 미만 (표본 ${sized.length})` };
  const ppms = use.map(g => g.ppm);
  const ppm = median(ppms);
  const spread = ppms.length > 1 ? Math.max(...ppms) / Math.min(...ppms) : 1;
  const radius = Math.max(...use.map(g => g.m));
  const reliable = spread <= 1.7 && (use.length >= 2 || method === '같은 단지 실거래') && trades.length >= 3;
  return {
    status: !reliable ? '편차 큼' : trades.length >= 5 ? '확인' : '표본 적음',
    reliable, method, spread: +spread.toFixed(2),
    radius: Math.ceil(radius / 100) * 100, sample: trades.length, months, newTown, maxAge, lawds: lawds.length,
    estimate: Math.round((ppm * area) / 1e6) * 1e6,
    perPyeong: Math.round(ppm * 3.3058),
    keys: use.map(keyOf),
    complexes: use.map(g => ({ name: g.apt, m: Math.round(g.m), n: g.trades.length, built: g.trades[0].built, kind: g.kind, self: isSelf(g),
      median: Math.round(g.ppm * area / 1e6) * 1e6, latest: g.trades.sort((a, b) => b.date.localeCompare(a.date))[0]?.date })),
  };
}
