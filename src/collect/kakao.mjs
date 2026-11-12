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
  async function region(x, y) {
    const rev = await get(`https://dapi.kakao.com/v2/local/geo/coord2regioncode.json?x=${x}&y=${y}`);
    const b = rev.documents?.find(r => r.region_type === 'B');
    return { bcode: b?.code || null, lawd: b?.code?.slice(0, 5) || null, regionName: b?.address_name || null };
  }

  /**
   * 주소 → 좌표. 신도시 블록 주소("거모지구 내 A-6블록")처럼 정식 주소가 아닌 경우가 많아서
   * 1) 주소 검색 2) 키워드 검색(지구명 포함) 순으로 뒤에서부터 단어를 줄여 가며 찾는다.
   * precise=false면 지구·동 단위 대략 위치라는 뜻.
   */
  async function geocode(address) {
    const clean = address
      .replace(/\(.*?\)|\[.*?\]/g, ' ')
      .replace(/\s+(일원|일대|내)(\s|$)/g, ' ')
      .replace(/외\s*\d*\s*필지/g, ' ')
      .replace(/[,·]/g, ' ')
      .replace(/\s+/g, ' ').trim();
    const words = clean.split(' ');
    const isBlock = w => /^[A-Z]{1,2}-?\d+|\d+블[록럭]|BL$|블[록럭]$/i.test(w);
    const core = words.filter(w => !isBlock(w));
    // "경기도 시흥시"까지 줄이면 시청이 잡히므로 행정주소는 3단어까지만, 지구명만 있는 짧은 이름은 1단어까지
    const minN = /^(서울|경기|인천)/.test(core[0] || '') ? Math.min(3, core.length) : 1;
    for (let n = core.length; n >= minN; n--) {
      const q = core.slice(0, n).join(' ');
      const a = (await get(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(q)}&size=1`)).documents?.[0];
      if (a) {
        const r = a.address?.b_code ? { bcode: a.address.b_code, lawd: a.address.b_code.slice(0, 5) } : await region(a.x, a.y);
        return { x: +a.x, y: +a.y, ...r, address: a.address_name, query: q, precise: n === core.length && !words.some(isBlock) };
      }
      const k = (await get(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(q)}&size=1`)).documents?.[0];
      if (k) return { x: +k.x, y: +k.y, ...(await region(k.x, k.y)), address: k.address_name, query: q, place: k.place_name, precise: false };
    }
    return null;
  }

  async function nearby({ x, y }) {
    const cat = async (code, radius) =>
      (await get(`https://dapi.kakao.com/v2/local/search/category.json?category_group_code=${code}&x=${x}&y=${y}&radius=${radius}&sort=distance&size=15`)).documents || [];
    const subway = (await cat('SW8', 2000)).map(d => ({ name: d.place_name, line: d.category_name.split('>').pop().trim(), m: +d.distance }));
    const schools = (await cat('SC4', 1500)).map(d => ({ name: d.place_name, m: +d.distance }));
    // 학원 수: 첫 페이지만 받아도 meta.total_count에 1km 안 전체 개수가 온다
    const ac = await get(`https://dapi.kakao.com/v2/local/search/category.json?category_group_code=AC5&x=${x}&y=${y}&radius=1000&size=1`);
    const academies = ac.meta?.total_count ?? 0;
    return {
      subway: subway.slice(0, 3),
      elementary: schools.filter(s => /초등학교/.test(s.name)).slice(0, 2),
      middle: schools.filter(s => /중학교/.test(s.name)).slice(0, 1),
      academies1km: academies,
    };
  }

  /** 다음 월요일 08:00 출근, 18:30 퇴근 예측 (분) */
  async function commute({ x, y }, dest = CHURCH, base = new Date()) {
    const kst = new Date(base.getTime() + 9 * 3600e3);
    const add = ((8 - kst.getUTCDay()) % 7) || 7; // 다음 월요일
    const mon = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + add));
    const day = mon.toISOString().slice(0, 10).replace(/-/g, '');
    const q = async (o, d, t) => {
      const j = await get(`https://apis-navi.kakaomobility.com/v1/future/directions?origin=${o.x},${o.y}&destination=${d.x},${d.y}&departure_time=${day}${t}&priority=RECOMMEND`);
      const s = j.routes?.[0]?.summary;
      return s ? { min: Math.round(s.duration / 60), km: +(s.distance / 1000).toFixed(1) } : null;
    };
    const go = await q({ x, y }, dest, '0800');
    const back = await q(dest, { x, y }, '1830');
    const avg = go && back ? Math.round((go.min + back.min) / 2) : (go || back)?.min ?? null;
    return { date: mon.toISOString().slice(0, 10), go, back, avg };
  }

  return { geocode, nearby, commute, get, region };
}

export function haversine(a, b) {
  const R = 6371000, toR = d => (d * Math.PI) / 180;
  const dLat = toR(b.y - a.y), dLng = toR(b.x - a.x);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.y)) * Math.cos(toR(b.y)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}
