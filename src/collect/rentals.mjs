// 공공임대 아파트 공고 수집: LH(공공 API) · SH(서울주택도시공사 게시판) · GH(경기주택도시공사 게시판)
// 아파트에 들어가 사는 임대만: 행복주택·국민임대·영구임대·통합공공임대·공공임대(분양전환)·장기전세·청년안심주택·재개발임대
// 빼는 것: 매입임대(다가구·빌라), 전세임대(보증금 지원), 기숙사·두레·사회주택, 상가·어린이집
// iH(인천도시공사)·마이홈은 해외 서버(GitHub)에서 접속이 막혀 수집하지 못한다 → 인천은 LH 공고로만 잡힌다.

const LH_URL = 'https://apis.data.go.kr/B552555/lhLeaseNoticeInfo1/lhLeaseNoticeInfo1';
const LH_TYPES = { '07': '국민임대', '08': '공공임대', '09': '영구임대', '10': '행복주택', '48': '통합공공임대', '42': '행복주택(신혼희망)' };
const METRO = /서울|경기|인천/;
const TYPE_RE = [
  ['행복주택(신혼희망)', /신혼희망.*행복|행복.*신혼희망/], ['행복주택', /행복주택/], ['국민임대', /국민임대|국민공공임대/], ['영구임대', /영구임대/],
  ['통합공공임대', /통합공공임대/], ['장기전세', /장기전세|미리내집|시프트/], ['청년안심주택', /청년안심주택|역세권\s*청년/],
  ['공공임대', /(10|5|50)년\s*공공임대|분양전환|공공임대주택/], ['재개발임대', /재개발임대/],
];
const SKIP = /매입임대|전세임대|희망하우징|기숙사|두레|사회주택|상가|어린이집|발표|결과|당첨|서류|안내문|입주안내|계약|명단|추첨|연기|취소|휴무|공동생활|수칙|선정|감정평가|설명회|정정\s*안내|재공고\s*안내|임대료\s*인상|갱신/;
const typeOf = t => TYPE_RE.find(([, re]) => re.test(t))?.[0] || null;
const ymd = s => (s ? s.replace(/\./g, '-').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3') : null);
const compact = s => s.replace(/-/g, '');
const text = h => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

/** 공고 본문에서 접수 기간 찾기: '접수·신청' 근처 날짜 */
export function windowFromText(t, year) {
  const DATE = /(20\d{2})\s*[.\-년]\s*(\d{1,2})\s*[.\-월]\s*(\d{1,2})/g;
  const found = [];
  for (const m of t.matchAll(/(접수|신청)\s*(기간|일정|일시|기한)?[^0-9]{0,30}((?:20\d{2}\s*[.\-년]\s*\d{1,2}\s*[.\-월]\s*\d{1,2}[^0-9]{0,25}){1,3})/g)) {
    for (const d of m[3].matchAll(DATE)) found.push(`${d[1]}-${d[2].padStart(2, '0')}-${d[3].padStart(2, '0')}`);
  }
  // '11.20(목) ~ 11.24(월)'처럼 연도 없는 표기
  if (!found.length && year) for (const m of t.matchAll(/(접수|신청)\s*(기간|일정)?[^0-9]{0,20}(\d{1,2})\s*\.\s*(\d{1,2})\.?\s*\([^)]*\)?\s*[~∼-]\s*(\d{1,2})\s*\.\s*(\d{1,2})/g)) {
    found.push(`${year}-${m[3].padStart(2, '0')}-${m[4].padStart(2, '0')}`, `${year}-${m[5].padStart(2, '0')}-${m[6].padStart(2, '0')}`);
  }
  const ok = found.filter(d => !isNaN(Date.parse(d))).sort();
  return ok.length ? { start: ok[0], end: ok.at(-1) } : null;
}

async function lh({ key, from, log }) {
  const since = new Date(Date.parse(from) - 90 * 864e5).toISOString().slice(0, 10);
  const rows = [];
  for (let page = 1; page <= 20; page++) {
    const u = new URL(LH_URL);
    u.searchParams.set('serviceKey', key); u.searchParams.set('PG_SZ', 500); u.searchParams.set('PAGE', page);
    u.searchParams.set('PAN_ST_DT', compact(since)); u.searchParams.set('PAN_ED_DT', compact(from));
    const r = await fetch(u);
    if (!r.ok) throw new Error(`LH HTTP ${r.status}`);
    const list = (JSON.parse((await r.text()).trim()).find?.(x => x.dsList) || {}).dsList || [];
    rows.push(...list);
    if (!list.length || rows.length >= +(list[0]?.ALL_CNT || 0)) break;
  }
  const out = [];
  for (const r of rows) {
    const type = LH_TYPES[r.AIS_TP_CD];
    if (!type || !METRO.test(r.CNP_CD_NM) || r.PAN_SS === '접수마감') continue;
    const end = ymd(r.CLSG_DT);
    if (!end || end < from) continue;
    out.push({ source: 'lh', agency: 'LH', id: `lh-${r.PAN_ID}`, name: r.PAN_NM.replace(/^\[정정공고\]\s*/, '').trim(), rentalType: type,
      region: r.CNP_CD_NM.replace(/특별시|광역시|도$/, ''), noticeDate: ymd(r.PAN_DT), window: { start: ymd(r.PAN_NT_ST_DT) || ymd(r.PAN_DT), end },
      status: r.PAN_SS, noticeUrl: r.DTL_URL_MOB || r.DTL_URL, corrected: /정정/.test(r.PAN_NM) });
  }
  // 정정공고가 있으면 원공고 대신
  const by = new Map(); for (const it of out) { const k = it.name; if (!by.has(k) || it.corrected) by.set(k, it); }
  const items = [...by.values()];
  log(`[임대] LH 전체 ${rows.length} / 수도권 아파트 임대 진행중 ${items.length}`);
  return items;
}

async function sh({ from, log }) {
  const BASE = 'https://www.i-sh.co.kr/main/lay2/program/S1T294C297/www/brd/m_247/';
  const rows = [];
  for (let page = 1; page <= 4; page++) {
    const r = await fetch(BASE + 'list.do', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `notType1=2&page=${page}` });
    const h = await r.text();
    const got = [...h.matchAll(/getDetailView\('(\d+)'\)[^>]*>\s*([\s\S]*?)<\/a>[\s\S]*?<td[^>]*>\s*([^<]*?)\s*<\/td>\s*(?:<!--[^>]*-->\s*)?<td class="num">\s*(\d{4}-\d{2}-\d{2})/g)]
      .map(m => ({ seq: m[1], title: text(m[2]).trim(), dept: m[3].trim(), date: m[4] }));
    rows.push(...got);
    if (!got.length || got.at(-1).date < new Date(Date.parse(from) - 60 * 864e5).toISOString().slice(0, 10)) break;
  }
  const out = [];
  for (const r of rows) {
    const type = typeOf(r.title);
    if (!type || SKIP.test(r.title) || !/모집|공급|청약/.test(r.title)) continue;
    if (r.date < new Date(Date.parse(from) - 45 * 864e5).toISOString().slice(0, 10)) continue;
    const url = `${BASE}view.do?seq=${r.seq}`;
    let w = null;
    try { w = windowFromText(text(await (await fetch(url)).text()), r.date.slice(0, 4)); } catch {}
    if (w && w.end < from) continue;
    if (!w && r.date < new Date(Date.parse(from) - 21 * 864e5).toISOString().slice(0, 10)) continue; // 기간을 못 찾았고 3주 넘은 공고는 끝났을 가능성이 큼
    out.push({ source: 'sh', agency: 'SH', id: `sh-${r.seq}`, name: r.title, rentalType: type, region: /의정부|경기/.test(r.title) ? '경기' : '서울',
      noticeDate: r.date, window: w || { start: r.date, end: null }, endUnknown: !w, noticeUrl: url });
  }
  log(`[임대] SH 주택임대 게시글 ${rows.length} / 아파트 임대 모집 진행중 ${out.length}`);
  return out;
}

async function gh({ from, log }) {
  const BASE = 'https://www.gh.or.kr/gh/announcement-of-salerental001.do';
  const h = await (await fetch(`${BASE}?article.offset=0&articleLimit=60`)).text();
  const rows = [...h.matchAll(/<td class="category">\s*([^<]*?)\s*<\/td>[\s\S]*?articleNo=(\d+)[^>]*>\s*([\s\S]*?)<\/a>[\s\S]*?<td class="date">\s*(\d{2})\.(\d{2})\.(\d{2})/g)]
    .map(m => ({ cat: m[1], no: m[2], title: text(m[3]).trim(), date: `20${m[4]}-${m[5]}-${m[6]}` }));
  const out = [];
  for (const r of rows) {
    const type = typeOf(r.title);
    if (r.cat !== '주택' || !type || SKIP.test(r.title) || !/모집|공급/.test(r.title)) continue;
    if (r.date < new Date(Date.parse(from) - 45 * 864e5).toISOString().slice(0, 10)) continue;
    const url = `${BASE}?mode=view&articleNo=${r.no}`;
    let w = null;
    try { w = windowFromText(text(await (await fetch(url)).text()), r.date.slice(0, 4)); } catch {}
    if (w && w.end < from) continue;
    if (!w && r.date < new Date(Date.parse(from) - 21 * 864e5).toISOString().slice(0, 10)) continue;
    out.push({ source: 'gh', agency: 'GH', id: `gh-${r.no}`, name: r.title, rentalType: type, region: '경기',
      noticeDate: r.date, window: w || { start: r.date, end: null }, endUnknown: !w, noticeUrl: url });
  }
  log(`[임대] GH 게시글 ${rows.length} / 아파트 임대 모집 진행중 ${out.length}`);
  return out;
}

/** 청약홈 공공지원민간임대(아파트형 민간임대) */
export function fromApplyhomeRental(rows = []) {
  return rows.map(r => ({ ...r, source: 'applyhome', agency: '청약홈', rentalType: '공공지원민간임대' }));
}

export async function collectRentals({ key, from, log = console.log }) {
  const stats = {}, items = [];
  for (const [name, fn] of [['lh', lh], ['sh', sh], ['gh', gh]]) {
    try { const got = await fn({ key, from, log }); items.push(...got); stats[name] = { ok: true, kept: got.length }; }
    catch (e) { stats[name] = { ok: false, error: String(e.message || e) }; log(`[임대] ${name} 실패: ${e.message}`); }
  }
  return { items, stats };
}
