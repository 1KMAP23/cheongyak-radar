// 공고별 '전문가 한 줄 평' 만들기 (규칙 기반).
// 1줄: 어떤 청약인가 (유형·지역 성격·규모·브랜드·핵심 입지)
// 2줄: 가격을 어떻게 봐야 하나 (시세 대비·예상치·비교 불가 이유)
// 3줄: 어떻게 접근할까 (실거주/시세차익/장기/당첨 확률/주의)
// + 장점·단점 목록. 앱 화면에서 우리 집 정보(자격·직장)와 함께 계산한다.
import { won, brandOf, typeRows } from './rules.js';

const LINE_PREMIUM = /2호선|9호선|신분당선|GTX|3호선|7호선/;
const SEOUL_CORE = /강남구|서초구|송파구|용산구|성동구|마포구|강동구|광진구|동작구|양천구|영등포구/;
const NEWTOWN = /지구|블[록럭]|BL|택지|신도시/;
const THIRD = /왕숙|교산|계양|대장|창릉|과천지구|안산장상|광명시흥|의왕군포안산|화성봉담|구리토평|남양주진접2|오산세교2|용인이동|평택지제/;

const sgnWon = m => `${m >= 0 ? '+' : '−'}${won(Math.abs(m))}`;
const yearsTo = (ym, today) => (ym ? (Date.parse(`${ym.slice(0, 4)}-${ym.slice(4, 6) || '01'}-01`) - Date.parse(today)) / (365.25 * 864e5) : null);

function repRow(it) {
  const rows = typeRows(it);
  return rows.find(r => r.area >= 82 && r.area <= 86) || rows.find(r => r.area >= 57 && r.area <= 61) || rows[0] || null;
}

/** 청약(분양) 공고 평 */
export function saleComment(it, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const pros = [], cons = [];
  const L = it.location || {}, C = L.commerce || {}, st = L.subway?.[0], el = L.elementary?.[0];
  const text = `${it.name || ''} ${it.address || ''}`;
  const seoul = (it.region || '').startsWith('서울') || /^서울/.test(it.address || '');
  const land = /토지임대부/.test(text);
  const newTown = NEWTOWN.test(text) && !seoul;
  const third = THIRD.test(text.replace(/\s/g, ''));
  const few = ['noRank', 'arbitrary'].includes(it.category);
  const brand = brandOf(it);
  const units = it.totalUnits;
  const r = repRow(it);
  const yrs = yearsTo(it.moveIn, today);
  const f = it.flags || {};

  // ── 1줄: 무엇인가 ──
  const where = seoul ? (SEOUL_CORE.test(text) ? '서울 핵심 지역' : '서울') : third ? '3기 신도시' : newTown ? '신도시·택지지구' : (it.region || '수도권');
  const stTxt = st ? (st.m <= 300 ? `초역세권(${st.name} ${st.m}m)` : st.m <= 800 ? `역세권(${st.name} ${st.m}m)` : st.m <= 1500 ? `${st.name} ${(st.m / 1000).toFixed(1)}km` : '') : '';
  let kind;
  if (land) kind = `토지임대부 분양 · 건물만 소유하고 토지는 공공(LH·SH) 소유, 매달 토지임대료`;
  else if (it.category === 'noRank') kind = `줍줍(무순위) ${units ? `잔여 ${units}세대` : ''} · 무주택이면 통장 없이 추첨`;
  else if (it.category === 'arbitrary') kind = `임의공급${it.invest?.repeated ? ` ${it.invest.repeated}차` : ''} ${units ? `${units}세대` : ''} · 통장·주택 수 상관없이 선착순/추첨`;
  else if (it.category === 'newlywedHopeTown') kind = `신혼희망타운 · 신혼·예비신혼·한부모 전용, 시세 차익 일부를 LH와 나누는 수익공유형`;
  else if (it.category === 'publicSale') kind = `공공분양${f.priceCap ? '(분양가상한제)' : ''} · 소득·자산 기준 있는 대신 분양가가 낮은 편`;
  else if (it.category === 'urban') kind = `도시형생활주택 · 아파트가 아닌 소형 주택(주택 수에는 포함)`;
  else kind = `민영 분양${f.priceCap ? '(분양가상한제)' : ''}${units ? ` ${units.toLocaleString()}세대` : ''}`;
  const head = [where, stTxt, brand ? `${brand} 브랜드` : (units && units < 300 && !few ? '비브랜드 소단지' : '')].filter(Boolean).join(' · ');
  const line1 = `${head} — ${kind.trim()}`;

  // ── 2줄: 가격 ──
  let line2, priceView = 'unknown';
  if (land) { line2 = `분양가에 땅값이 빠져 있어 주변 아파트 시세와 비교하는 의미가 작아요. ${r ? `${r.area}㎡ ${won(r.hi)}으로 같은 동네 아파트의 절반 이하인 경우가 많아요` : ''}`; priceView = 'land'; }
  else if (r?.marginHi != null && r.reliable !== false && !r.expected) {
    const pct = r.estimate ? Math.round(r.hi / r.estimate * 100) : null;
    priceView = r.marginHi >= 2e8 ? 'cheap' : r.marginHi >= 5e7 ? 'some' : r.marginHi >= -3e7 ? 'fair' : 'pricey';
    line2 = `${r.area}㎡ ${won(r.hi)}, 주변 실거래 시세 ${won(r.estimate)}${pct ? `(분양가가 시세의 ${pct}%)` : ''} → 안전마진 ${sgnWon(r.marginHi)}. ${{ cheap: '시세보다 확실히 싸요', some: '약간의 안전마진이 있어요', fair: '사실상 시세 수준 분양이에요', pricey: '주변 시세보다 비싸게 나왔어요' }[priceView]}`;
  } else if (r?.expected && r.marginHi != null) {
    priceView = r.marginHi >= 1e8 ? 'some' : r.marginHi >= -3e7 ? 'fair' : 'pricey';
    line2 = `주변에 비교할 새 아파트 거래가 없어 인근 민간 신축 분양가로 본 예상 시세 ${won(r.estimate)} 대비 ${sgnWon(r.marginHi)}(예상). 입주 후 시세는 교통·상권이 얼마나 갖춰지느냐에 달렸어요`;
  } else if (r) line2 = `${r.area}㎡ ${won(r.hi)}. 주변 비교 거래가 적거나 들쭉날쭉해 시세 판단이 어려워요 — 인근 신축 시세를 직접 비교해 보세요`;
  else line2 = '공고 데이터에 주택형·분양가가 없어요. 공고문에서 가격을 확인하세요';

  // ── 장점·단점 ──
  if (st && st.m <= 500) pros.push(`${st.name} 도보권(${st.m}m)${LINE_PREMIUM.test(st.line || st.name) ? ' · 강남·도심 접근 좋은 노선' : ''}`);
  else if (!st || st.m > 1500) cons.push(st ? `지하철 ${(st.m / 1000).toFixed(1)}km — 버스·차 의존` : '반경 2km 안에 지하철 없음');
  if (el && el.m <= 350) pros.push(`초품아급(${el.name} ${el.m}m)`);
  if ((L.academies1km || 0) >= 100) pros.push(`학원가(1km 안 ${L.academies1km}곳)`);
  else if (L.academies1km != null && L.academies1km < 15) cons.push('학원 적음');
  if (C.mart && C.mart.m <= 1500) pros.push(`대형마트 ${C.mart.name.replace(/\s.*$/, '')} ${(C.mart.m / 1000).toFixed(1)}km`);
  if (C.food1km != null) { if (C.food1km >= 300) pros.push(`생활 상권 탄탄(1km 안 음식점 ${C.food1km}곳)`); else if (C.food1km < 50) cons.push('주변 상권 아직 약함'); }
  if (C.hospital1km != null && C.hospital1km < 5) cons.push('병원 적음');
  if (brand) pros.push(`${brand}(시공 상위 10위) 브랜드`); else if (it.builder && !few) cons.push('비브랜드 → 환금성 약할 수 있음');
  if (units >= 1000 && !few) pros.push(`대단지(${units.toLocaleString()}세대)`);
  if (f.priceCap) pros.push('분양가상한제 → 분양가가 눌려 있음');
  if (land) cons.push('토지임대료 매달 부담 · 토지를 소유하지 않아 매매 차익 제한');
  if (it.category === 'newlywedHopeTown') cons.push('시세 차익의 일부를 LH와 나눠야 함(수익공유)');
  if (it.invest?.repeated) cons.push(`${it.invest.repeated}차 재공급 — 시장이 이미 외면한 물량`);
  if (yrs != null && yrs >= 3.5) cons.push(`입주까지 약 ${Math.round(yrs)}년 — 자금이 오래 묶임`);
  if (yrs != null && yrs <= 0.6 && !few) pros.push('곧 입주');
  if (f.priceCap && f.publicLand) cons.push('실거주 의무 가능성 → 전세 놓기 어려움');
  if (third) pros.push('3기 신도시 — 교통 계획이 실현되면 가치 상승 여지');
  if (newTown && !third) pros.push('계획 신도시 — 기반시설이 갖춰지면 시세 형성');
  if (it.competition?.maxRate >= 10) pros.push(`경쟁률 최고 ${it.competition.maxRate}:1 — 시장 관심 높음`);
  if (it.competition?.maxRate != null && it.competition.maxRate < 1) cons.push('미달 — 수요 약함');

  // ── 3줄: 어떻게 접근할까 ──
  let line3;
  if (land) line3 = '저렴하게 오래 사는 실거주 메리트로 접근하세요. 시세 차익을 기대하는 투자용으로는 맞지 않아요';
  else if (few && units && units <= 3) line3 = `${units}세대 추첨이라 당첨 확률은 매우 낮아요. 통장이 필요 없어 넣어볼 만하지만, 당첨되면 유주택이 돼 특공 기회가 사라지니 그 점을 먼저 따져 보세요`;
  else if (it.invest?.repeated >= 3) line3 = '여러 번 남은 물량이라 할인·조건 변경이 없다면 신중하게. 실거주로 입지가 맞을 때만 고려하세요';
  else if (priceView === 'cheap') line3 = '시세차익형 — 당첨되면 이득이 큰 만큼 경쟁이 치열해요. 가점·추첨 비율과 실거주 의무·전매 제한을 확인하고 도전하세요';
  else if (priceView === 'some') line3 = '안전마진이 조금 있어요. 실거주 겸 투자로 접근할 만하고, 입지(역·학군)가 내 생활권과 맞는지가 관건이에요';
  else if (priceView === 'fair') line3 = '가격 메리트는 크지 않아요. 새 아파트에 실거주할 목적이고 입지가 맞을 때 넣으세요';
  else if (priceView === 'pricey') line3 = '분양가가 주변 시세보다 높아 투자 매력은 낮아요. 꼭 그 동네에 살아야 하는 경우가 아니면 다음 공고를 기다리는 게 나아요';
  else if (third || newTown) line3 = `지금 시세로는 판단이 어렵고 미래 가치(교통·상권 완성)에 거는 청약이에요${yrs != null && yrs >= 3 ? `. 입주까지 ${Math.round(yrs)}년, 장기 관점으로 접근하세요` : ''}`;
  else line3 = '시세 판단이 어려워요. 공고문 분양가를 인근 신축 실거래·호가와 직접 비교한 뒤 결정하세요';

  return { lines: [line1, line2, line3], pros: [...new Set(pros)].slice(0, 6), cons: [...new Set(cons)].slice(0, 6) };
}

/** 임대 공고 평 */
export function rentalComment(it) {
  const pros = [], cons = [];
  const L = it.location || {}, C = L.commerce || {}, st = L.subway?.[0], pl = it.priceLevel;
  const t = it.rentalType;
  const ABOUT = {
    '행복주택': '청년·신혼·고령자용 공공임대. 주변 시세의 60~80% 임대료, 최장 6~10년(자녀 있으면 연장)',
    '행복주택(신혼희망)': '신혼부부 전용 행복주택. 시세 대비 저렴, 자녀 수에 따라 최장 10년',
    '국민임대': '무주택 서민용 장기임대. 시세의 60~80%, 최장 30년. 예비입주자는 빈집이 생길 때 순서대로 입주',
    '영구임대': '수급자·차상위 등 대상 계층용, 임대료 가장 저렴',
    '통합공공임대': '국민·영구·행복을 합친 새 유형. 소득에 따라 시세의 35~90%, 최장 30년',
    '공공임대': '10년 살고 분양전환받는 임대. 분양전환가는 감정평가로 정해짐',
    '장기전세': '월세 없이 주변 전세 시세의 80% 이하 보증금, 최장 20년(SH 미리내집은 출산 시 우선매수권)',
    '청년안심주택': '역세권 청년·신혼용 임대(공공·민간분). 역 가까운 대신 면적이 작은 편',
    '공공지원민간임대': '민간이 짓고 공공이 지원하는 8~10년 임대. 임대료 상승 연 5% 제한',
    '재개발임대': '재개발 단지 안의 임대 동. 입지는 좋지만 물량이 적음',
  };
  if (st && st.m <= 500) pros.push(`${st.name} 도보권(${st.m}m)`); else if (!st || st.m > 1500) cons.push(st ? `지하철 ${(st.m / 1000).toFixed(1)}km` : '지하철 멀음');
  if (pl?.perPyeong >= 3.5e7) pros.push(`주변 시세 높은 동네(59㎡ 약 ${won(pl.at59)}) — 같은 돈으로 좋은 입지에 거주`);
  else if (pl?.perPyeong && pl.perPyeong < 1.8e7) cons.push('주변 시세가 낮은 지역');
  if (C.mart && C.mart.m <= 1500) pros.push(`대형마트 ${(C.mart.m / 1000).toFixed(1)}km`);
  if (C.food1km != null && C.food1km < 50) cons.push('상권 약함');
  if ((L.academies1km || 0) >= 100) pros.push('학원가 가까움');
  if (/예비입주자/.test(it.name)) cons.push('예비입주자 모집 — 당첨돼도 빈집이 날 때까지 대기');
  if (it.analysisNote && /여러 단지/.test(it.analysisNote)) cons.push('여러 단지 묶음 공고 — 단지별 위치 확인 필요');
  const line1 = `${t} — ${ABOUT[t] || '공공임대'}`;
  const line2 = pl?.at59 ? `주변 아파트 59㎡ 매매가 약 ${won(pl.at59)}(평당 ${won(pl.perPyeong)}) 동네. 임대료·보증금은 공고문에서 확인하세요` : '주변 매매 시세 정보가 적어요. 임대료·보증금은 공고문에서 확인하세요';
  let line3;
  if (it.eligibility?.status === '불가') line3 = `우리 집은 ${it.eligTag?.why || '기준'} 때문에 자격이 안 돼요${/총자산/.test(it.eligTag?.why || '') ? ' — 자산 기준이 바뀌거나 아이가 생기면 다시 확인해 보세요' : ''}`;
  else if (t === '장기전세') line3 = '월세 부담 없이 오래 살 수 있는 실거주용으로 가장 매력적인 임대예요. 자산 기준만 공고문에서 확인하세요';
  else if (/예비입주자/.test(it.name)) line3 = '당장 이사가 아니라 대기 순번을 받는 공고예요. 이사 시점이 유연할 때 넣어 두세요';
  else line3 = '분양 대신 저렴하게 오래 살면서 목돈을 모으는 실거주 전략으로 접근하세요';
  return { lines: [line1, line2, line3], pros: [...new Set(pros)].slice(0, 5), cons: [...new Set(cons)].slice(0, 5) };
}
