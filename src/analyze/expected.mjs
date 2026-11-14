// 신도시처럼 주변에 비교할 실거래가 없을 때 쓰는 '예상 시세'.
// 1) config/expected-prices.json에 사람이 넣은 값(출처 포함)이 있으면 그것
// 2) 없으면 반경 8km 안 최근 18개월 민간 신축 분양가(㎡당 최고 분양가 중위값) × 전용면적.
//    시행사가 민간 분양가를 '입주 후 시세'에 맞춰 정하는 경우가 많아 새 아파트 기대 시세의 기준점으로 쓴다.
import { readFileSync, existsSync } from 'node:fs';
import { haversine } from '../collect/kakao.mjs';
import { recentPrivate, modelsOf } from '../collect/applyhome.mjs';

const stem = n => String(n || '').replace(/\(.*?\)|\[.*?\]|\s|아파트|입주자모집공고|공고/g, '').slice(0, 8);
const median = a => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };

export function makeExpected({ key, kakao, from, log = console.log }) {
  const manual = existsSync('config/expected-prices.json') ? JSON.parse(readFileSync('config/expected-prices.json', 'utf8')) : [];
  let list = null;
  const models = new Map();
  async function load() {
    if (list) return list;
    try {
      const rows = await recentPrivate({ key, from });
      list = [];
      for (const r of rows) { try { const g = r.address ? await kakao.geocode(r.address) : null; if (g) list.push({ ...r, geo: g }); } catch {} }
      log(`[예상 시세] 최근 18개월 수도권 민영 분양 ${rows.length}건 (위치 확인 ${list.length})`);
    } catch (e) { log(`[예상 시세] 민영 분양 목록 실패: ${e.message}`); list = []; }
    return list;
  }
  return async function expected(it, point, area) {
    const m = manual.find(x => (it.name || '').includes(x.match) && (!x.block || (it.name || '').includes(x.block)));
    const key84 = m && Object.keys(m.areas || {}).map(Number).sort((a, b) => Math.abs(a - area) - Math.abs(b - area))[0];
    if (m && key84 != null && Math.abs(key84 - area) <= 8) return { estimate: m.areas[key84], kind: 'manual', source: m.source, url: m.url || null, refs: [] };
    const all = await load();
    // 자기 자신(조합원 취소분 등 이름만 다른 같은 단지)은 빼고, 같은 단지 공고가 여러 번이면 하나만
    const seen = new Set([stem(it.name)]);
    const near = all.filter(r => r.houseManageNo !== it.houseManageNo)
      .map(r => ({ ...r, m: haversine(point, r.geo) })).filter(r => r.m <= 8000).sort((a, b) => a.m - b.m)
      .filter(r => { const k = stem(r.name); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 4);
    const refs = [];
    for (const r of near) {
      if (!models.has(r.houseManageNo)) { try { models.set(r.houseManageNo, await modelsOf(key, r.houseManageNo)); } catch { models.set(r.houseManageNo, []); } }
      const ms = models.get(r.houseManageNo);
      const close = ms.filter(x => Math.abs(x.area - area) <= 10);
      const use = close.length ? close : ms;
      if (!use.length) continue;
      const ppm = median(use.map(x => x.topPrice / x.area));
      refs.push({ name: r.name, m: Math.round(r.m), noticeDate: r.noticeDate, ppm, atArea: Math.round(ppm * area / 1e6) * 1e6 });
      if (refs.length >= 3) break;
    }
    if (!refs.length) return null;
    return { estimate: Math.round(median(refs.map(r => r.ppm)) * area / 1e6) * 1e6, kind: 'auto', source: `반경 ${(Math.max(...refs.map(r => r.m)) / 1000).toFixed(1)}km 최근 민간 신축 분양가 ${refs.length}곳`, refs };
  };
}
