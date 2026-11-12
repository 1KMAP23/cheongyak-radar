// 카카오 로컬 + 카카오모빌리티 미래 길찾기
export const CHURCH = { name: '오륜교회', x: 127.132395701923, y: 37.522741716368, address: '서울 강동구 강동대로 235' };

const cache = new Map();

export function makeKakao(restKey) {
  const H = { Authorization: `KakaoAK ${restKey}` };

  async function get(url) {
    if (cache.has(url)) return cache.get(url);
    for (let i = 0; i < 3; i++) {
      const r = await fetch(url, { headers: H });
      if (r.status === 429) { await new Promise(s => setTimeout(s, 1000 * (i + 1))); continue; }
      if (!r.ok) throw new Error(`kakao HTTP ${r.status} ${url.split('?')[0]}`);
      const j = await r.json();
      cache.set(url, j);
      return j;
    }
    throw new Error('kakao 429');
  }

  /** 주소 → {x, y, bcode(법정동 10자리), lawd(시군구 5자리), address} */
  async function geocode(address) {
    const clean = address.replace(/\(.*?\)/g, ' ').replace(/\s+일원|\s+일대|\s+외\s*\d*필지/g, '').trim();
    const tries = [clean, clean.replace(/\s+\S*블[록럭]\S*/g, ''), clean.split(' ').slice(0, 4).join(' ')];
    for (const q of tries) {
      const j = await get(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(q)}&size=1`);
      const d = j.documents?.[0];
      if (d) {
        return { x: +d.x, y: +d.y, bcode: d.address?.b_code || null, lawd: (d.address?.b_code || '').slice(0, 5) || null, address: d.address_name, query: q };
      }
    }
    // 주소 검색 실패 시 키워드 검색 (지구·블록 이름만 있는 공고 대비)
    const j = await get(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(clean)}&size=1`);
    const d = j.documents?.[0];
    if (!d) return null;
    const rev = await get(`https://dapi.kakao.com/v2/local/geo/coord2regioncode.json?x=${d.x}&y=${d.y}`);
    const b = rev.documents?.find(r => r.region_type === 'B');
    return { x: +d.x, y: +d.y, bcode: b?.code || null, lawd: b?.code?.slice(0, 5) || null, address: d.address_name, query: clean, approx: true };
  }

  async function nearby({ x, y }) {
    const cat = async (code, radius) =>
      (await get(`https://dapi.kakao.com/v2/local/search/category.json?category_group_code=${code}&x=${x}&y=${y}&radius=${radius}&sort=distance&size=15`)).documents || [];
    const subway = (await cat('SW8', 2000)).map(d => ({ name: d.place_name, line: d.category_name.split('>').pop().trim(), m: +d.distance }));
    const schools = (await cat('SC4', 1500)).map(d => ({ name: d.place_name, m: +d.distance }));
    const academies = (await cat('AC5', 1000)).length; // 학원 수 (1km, 최대 15까지만 셈)
    return {
      subway: subway.slice(0, 3),
      elementary: schools.filter(s => /초등학교/.test(s.name)).slice(0, 2),
      middle: schools.filter(s => /중학교/.test(s.name)).slice(0, 1),
      academies1km: academies,
    };
  }

  /** 다음 월요일 08:00 출근, 18:30 퇴근 예측 (분) */
  async function commute({ x, y }, base = new Date()) {
    const kst = new Date(base.getTime() + 9 * 3600e3);
    const add = ((8 - kst.getUTCDay()) % 7) || 7; // 다음 월요일
    const mon = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + add));
    const day = mon.toISOString().slice(0, 10).replace(/-/g, '');
    const q = async (o, d, t) => {
      const j = await get(`https://apis-navi.kakaomobility.com/v1/future/directions?origin=${o.x},${o.y}&destination=${d.x},${d.y}&departure_time=${day}${t}&priority=RECOMMEND`);
      const s = j.routes?.[0]?.summary;
      return s ? { min: Math.round(s.duration / 60), km: +(s.distance / 1000).toFixed(1) } : null;
    };
    const go = await q({ x, y }, CHURCH, '0800');
    const back = await q(CHURCH, { x, y }, '1830');
    const avg = go && back ? Math.round((go.min + back.min) / 2) : (go || back)?.min ?? null;
    return { date: mon.toISOString().slice(0, 10), go, back, avg };
  }

  return { geocode, nearby, commute, get };
}

export function haversine(a, b) {
  const R = 6371000, toR = d => (d * Math.PI) / 180;
  const dLat = toR(b.y - a.y), dLng = toR(b.x - a.x);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.y)) * Math.cos(toR(b.y)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}
