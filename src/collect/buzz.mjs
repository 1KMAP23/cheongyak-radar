// 화제성: 카카오(다음) 검색에서 최근 14일 블로그·카페·영상·웹문서 언급 수
// 스레드·인스타그램은 공개 검색 API가 없어 직접 못 센다. 블로그·카페·유튜브(영상) 언급으로 대신한다.
const DAYS = 14, PAGES = 3, SIZE = 50;

// 어느 단지 이름에나 들어가는 흔한 말: 검색어에서 빼고, 관련 글 판정에도 안 쓴다
const GENERIC = /^(공공분양주택|공공분양|공공주택|분양주택|신혼희망타운|신혼희망|행복주택|본청약|사전청약|입주자|모집|공고|잔여세대|추가|아파트|주택|블록|지구|공공주택지구|도시개발사업|일반매각|공가세대|다세대주택|무순위|무주택세대구성원|유주택자|가능)$/;
const BLOCK = /^[A-Z]{1,2}-?\d+[A-Z]?(블[록럭]|BL)?$|^\d+블[록럭]$/i;
const norm = s => s.replace(/<[^>]+>/g, '').replace(/[\s·()\-_,.]/g, '').toLowerCase();

export function searchTerms(it) {
  const words = it.name
    .replace(/\(\d+차\)|\[.*?\]/g, ' ')
    .replace(/\(([^)]*)\)/g, ' $1 ')
    .replace(/[,·]/g, ' ')
    .split(/\s+/).filter(Boolean);
  const block = words.find(w => BLOCK.test(w))?.replace(/(블[록럭]|BL)$/i, '') || null;
  const core = words.filter(w => !BLOCK.test(w) && !GENERIC.test(w) && !/^\d+$/.test(w) && !/입주자|모집|공고|매각/.test(w));
  // 브랜드는 보통 이름 뒤쪽에 있다 ("평택 고덕 국제신도시 A-55 대광로제비앙 모아엘가")
  const key = core.length > 3 ? core.slice(-3) : core;
  return { query: [...key, block].filter(Boolean).join(' '), must: [...key.map(norm), block && norm(block)].filter(Boolean) };
}

export async function buzz(kakao, it) {
  const { query, must } = searchTerms(it);
  const since = Date.now() - DAYS * 864e5;
  const res = { query, days: DAYS };
  if (/공가세대|매각/.test(it.name)) return { ...res, blog: 0, cafe: 0, vclip: 0, web: 0, score: 0, skipped: '여러 단지 공가 매각' };
  if (!must.length) return { ...res, blog: 0, cafe: 0, vclip: 0, web: 0, score: 0, skipped: '고유 이름 없음' };
  for (const t of ['blog', 'cafe', 'vclip', 'web']) {
    let recent = 0, capped = false;
    for (let p = 1; p <= PAGES; p++) {
      const j = await kakao.get(`https://dapi.kakao.com/v2/search/${t}?query=${encodeURIComponent(query)}&sort=recency&size=${SIZE}&page=${p}`);
      const docs = j.documents || [];
      const fresh = docs.filter(d => Date.parse(d.datetime) >= since);
      // 관련 글만: 제목+본문에 고유 단어가 모두 들어 있어야 센다
      recent += fresh.filter(d => { const txt = norm(`${d.title || ''} ${d.contents || ''}`); return must.every(m => txt.includes(m)); }).length;
      if (j.meta?.is_end || fresh.length < docs.length || !docs.length) break;
      if (p === PAGES) capped = true;
    }
    res[t] = recent; if (capped) res[`${t}Capped`] = true;
  }
  // 카페(맘카페·부동산 카페)와 영상은 광고 블로그보다 실제 관심에 가까워서 가중치를 준다
  res.score = Math.round(res.blog + res.cafe * 3 + res.vclip * 2 + res.web * 0.5);
  return res;
}

/** 화제성 + 경쟁률 → 핫 등급. 기준은 이번 주 분포를 보고 정함 (docs/criteria.md) */
export function hotLevel(b, comp) {
  const rate = comp?.maxRate ?? 0;
  if ((b?.score ?? 0) >= 150 || rate >= 50) return 2;
  if ((b?.score ?? 0) >= 90 || rate >= 10) return 1;
  return 0;
}
