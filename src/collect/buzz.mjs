// 화제성: 카카오(다음) 검색에서 최근 14일 블로그·카페·영상·웹문서 언급 수
// 스레드·인스타그램은 공개 검색 API가 없어 직접 못 센다. 블로그·카페·유튜브(영상) 언급으로 대신한다.
const DAYS = 14, PAGES = 3, SIZE = 50; // 소스당 최대 150건까지 센다

export function searchName(it) {
  let n = it.name
    .replace(/\(\d+차\)|\[.*?\]/g, ' ')
    .replace(/\((?![^)]*BL)[^)]*\)/g, ' ')
    .replace(/(입주자\s*모집|잔여세대|추가|공고).*$/, '')
    .replace(/\s+/g, ' ').trim();
  if (n.length > 22) n = n.split(' ').slice(0, 3).join(' ');
  return n;
}

export async function buzz(kakao, it) {
  const q = searchName(it);
  const since = Date.now() - DAYS * 864e5;
  const res = { query: q, days: DAYS };
  for (const t of ['blog', 'cafe', 'vclip', 'web']) {
    let recent = 0, capped = false;
    for (let p = 1; p <= PAGES; p++) {
      const j = await kakao.get(`https://dapi.kakao.com/v2/search/${t}?query=${encodeURIComponent(`"${q}"`)}&sort=recency&size=${SIZE}&page=${p}`);
      const docs = j.documents || [];
      const hit = docs.filter(d => Date.parse(d.datetime) >= since).length;
      recent += hit;
      if (j.meta?.is_end || hit < docs.length || !docs.length) break;
      if (p === PAGES) capped = true;
    }
    res[t] = recent; if (capped) res[`${t}Capped`] = true;
  }
  // 카페(맘카페·부동산 카페)와 영상은 광고 블로그보다 실제 관심에 가까워서 가중치를 준다
  res.score = Math.min(150, res.blog) + res.cafe * 3 + res.vclip * 2 + Math.min(150, res.web) * 0.5;
  return res;
}

/** 화제성 + 경쟁률 → 핫 등급 */
export function hotLevel(b, comp) {
  const rate = comp?.maxRate ?? 0;
  if ((b?.score ?? 0) >= 220 || rate >= 50) return 2; // 매우 핫
  if ((b?.score ?? 0) >= 100 || rate >= 10) return 1; // 핫
  return 0;
}
