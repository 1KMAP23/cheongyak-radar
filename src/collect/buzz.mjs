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
  const titles = [];
  for (const t of ['blog', 'cafe', 'vclip', 'web']) {
    let recent = 0, capped = false;
    for (let p = 1; p <= PAGES; p++) {
      const j = await kakao.get(`https://dapi.kakao.com/v2/search/${t}?query=${encodeURIComponent(query)}&sort=recency&size=${SIZE}&page=${p}`);
      const docs = j.documents || [];
      const fresh = docs.filter(d => Date.parse(d.datetime) >= since);
      // 관련 글만: 제목+본문에 고유 단어가 모두 들어 있어야 센다
      const rel = fresh.filter(d => { const txt = norm(`${d.title || ''} ${d.contents || ''}`); return must.every(m => txt.includes(m)); });
      recent += rel.length;
      for (const d of rel) titles.push(`${d.title || ''} ${d.contents || ''}`.replace(/<[^>]+>/g, ''));
      if (j.meta?.is_end || fresh.length < docs.length || !docs.length) break;
      if (p === PAGES) capped = true;
    }
    res[t] = recent; if (capped) res[`${t}Capped`] = true;
  }
  // 카페(맘카페·부동산 카페)와 영상은 광고 블로그보다 실제 관심에 가까워서 가중치를 준다
  res.score = Math.round(res.blog + res.cafe * 3 + res.vclip * 2 + res.web * 0.5);
  res.reason = hotReason(res, titles, it);
  return res;
}

/** 화제성 + 경쟁률 → 핫 등급. 기준은 이번 주 분포를 보고 정함 (docs/criteria.md) */
export function hotLevel(b, comp) {
  const rate = comp?.maxRate ?? 0;
  if ((b?.score ?? 0) >= 150 || rate >= 50) return 2;
  if ((b?.score ?? 0) >= 90 || rate >= 10) return 1;
  return 0;
}

// 관련 글에서 자주 나온 화제 키워드 → 한 줄 이유
const TOPICS = [
  ['로또·시세차익', /로또|시세\s*차익|안전\s*마진|차익/],
  ['분양가 저렴', /분양가.{0,6}(저렴|착한|낮|싸)|저렴한\s*분양가/],
  ['줍줍·무순위', /줍줍|무순위|계약\s*취소/],
  ['경쟁률 높음', /경쟁률\s*[0-9.]+|[0-9.]+\s*(대|:)\s*1(?![0-9])|완판|조기\s*마감|1순위\s*마감/],
  ['역세권·교통', /역세권|GTX|초역세권|지하철|도보\s*\d+분/],
  ['학군', /학군|학원가|초품아|초등학교/],
  ['대단지·브랜드', /대단지|브랜드|1군/],
  ['미분양·할인', /미분양|할인|선착순|잔여\s*세대|특가/],
  ['견본주택 방문', /견본\s*주택|모델\s*하우스|방문\s*후기|임장/],
];
function hotReason(r, texts, it = {}) {
  // 공고 종류 자체를 말하는 주제는 이유가 못 된다 (무순위 공고에 '줍줍' 얘기가 많은 건 당연)
  const own = new Set();
  if (['noRank', 'arbitrary'].includes(it.category)) { own.add('줍줍·무순위'); own.add('미분양·할인'); }
  if (/잔여|선착순/.test(it.name || '')) own.add('미분양·할인');
  const hits = TOPICS.filter(([label]) => !own.has(label)).map(([label, re]) => [label, texts.filter(t => re.test(t)).length]).filter(([, n]) => n >= Math.max(2, texts.length * 0.1)).sort((a, b) => b[1] - a[1]).slice(0, 2);
  const src = [r.cafe >= 3 && `카페 ${r.cafe}건`, r.vclip >= 3 && `영상 ${r.vclip}건`, `블로그 ${r.blog}${r.blogCapped ? '+' : ''}건`].filter(Boolean).slice(0, 2).join('·');
  if (!hits.length) return `최근 2주 ${src} 언급`;
  return `‘${hits.map(h => h[0]).join('’·‘')}’ 얘기가 많아요 (최근 2주 ${src})`;
}
