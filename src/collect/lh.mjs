// LH 분양임대공고문 조회 (apis.data.go.kr/B552555/lhLeaseNoticeInfo1)
// 필드명·코드는 2026-11-12 실제 응답으로 확인함.
// AIS_TP_CD: 05 분양주택, 39 공공분양(신혼희망). 42 행복주택(신혼희망)은 임대라 제외.
const URL_ = 'https://apis.data.go.kr/B552555/lhLeaseNoticeInfo1/lhLeaseNoticeInfo1';
const SALE_TYPES = new Set(['05', '39']);
const METRO = /서울|경기|인천/;
const CLOSED = new Set(['접수마감', '상담요청']);

const ymd = s => (s ? s.replace(/\./g, '-').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3') : null);
const compact = s => s.replace(/-/g, '');

export async function collectLH({ key, from, sinceDays = 90, log = console.log }) {
  const since = new Date(Date.parse(from) - sinceDays * 864e5).toISOString().slice(0, 10);
  const rows = [];
  for (let page = 1; page <= 20; page++) {
    const u = new URL(URL_);
    u.searchParams.set('serviceKey', key);
    u.searchParams.set('PG_SZ', 500);
    u.searchParams.set('PAGE', page);
    u.searchParams.set('PAN_ST_DT', compact(since));
    u.searchParams.set('PAN_ED_DT', compact(from));
    const r = await fetch(u);
    if (!r.ok) throw new Error(`LH HTTP ${r.status}`);
    const j = JSON.parse((await r.text()).trim());
    const list = (j.find?.(x => x.dsList) || {}).dsList || [];
    rows.push(...list);
    const total = +(list[0]?.ALL_CNT || 0);
    if (!list.length || rows.length >= total) break;
  }

  const items = [];
  for (const r of rows) {
    if (!SALE_TYPES.has(r.AIS_TP_CD)) continue;
    if (!METRO.test(r.CNP_CD_NM)) continue;
    if (CLOSED.has(r.PAN_SS)) continue;
    const end = ymd(r.CLSG_DT);
    if (!end || end < from) continue;
    items.push({
      source: 'lh',
      kind: r.AIS_TP_CD === '39' ? 'lh-newlywed' : 'lh-sale',
      id: `lh-${r.PAN_ID}`,
      name: r.PAN_NM.replace(/^\[정정공고\]/, '').trim(),
      typeName: r.AIS_TP_CD_NM,
      region: r.CNP_CD_NM.replace(/특별시|광역시|도$/, ''),
      status: r.PAN_SS,
      noticeDate: ymd(r.PAN_DT),
      window: { start: ymd(r.PAN_DT), end },
      noticeUrl: r.DTL_URL_MOB || r.DTL_URL,
      corrected: /정정/.test(r.PAN_NM + r.PAN_SS),
    });
  }
  // 정정공고와 원공고가 같이 오면 정정 쪽 하나만 남긴다
  const byName = new Map();
  for (const it of items) {
    const k = it.name;
    if (!byName.has(k) || it.corrected) byName.set(k, it);
  }
  const out = [...byName.values()];
  log(`[lh] 전체 ${rows.length} / 수도권 분양·신희타 진행중 ${out.length}`);
  return { items: out, stats: { fetched: rows.length, kept: out.length } };
}

// 단지명 비교용 정규화: 괄호·블록·공고 문구 제거
export function nameKey(s) {
  return s
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/입주자\s*모집\s*공고|추가|잔여세대|공공분양주택|공공분양|본청약|신혼희망타운|블록|BL|주택/g, ' ')
    .replace(/[^0-9A-Za-z가-힣]/g, '')
    .toLowerCase();
}

/** 청약홈 목록과 대조해서 LH에만 있는 공고를 찾는다 */
export function crossCheck(applyhomeItems, lhItems) {
  const keys = applyhomeItems.map(i => nameKey(i.name));
  const onlyLH = [], matched = [];
  for (const it of lhItems) {
    const k = nameKey(it.name);
    const hit = keys.some(a => a && k && (a.includes(k) || k.includes(a) || overlap(a, k) >= 0.6));
    (hit ? matched : onlyLH).push(it);
  }
  return { onlyLH, matched };
}

function overlap(a, b) {
  const grams = s => new Set([...Array(Math.max(0, s.length - 1))].map((_, i) => s.slice(i, i + 2)));
  const A = grams(a), B = grams(b);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const g of A) if (B.has(g)) n++;
  return n / Math.min(A.size, B.size);
}
