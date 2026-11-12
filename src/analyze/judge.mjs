// docs/criteria.md 구현: 1) 자격 2) 투자 3) 출퇴근 → 종합
import { readFileSync } from 'node:fs';

const TH = JSON.parse(readFileSync(new URL('../../config/thresholds.json', import.meta.url)));
const won = n => (n == null ? '-' : n === 0 ? '0원' : n >= 1e8 ? `${(n / 1e8).toFixed(n % 1e8 ? 2 : 0).replace(/\.?0+$/, '')}억` : `${Math.round(n / 1e4).toLocaleString()}만`);
export { won };

function thresholds(year) {
  return TH[year] || TH[Object.keys(TH).filter(k => /^\d{4}$/.test(k)).sort().at(-1)];
}

// ── 1단계: 자격 ─────────────────────────────────────────────
export function category(it) {
  const n = it.name || '';
  if (/지분적립/.test(n)) return 'equityShare';
  if (it.typeName === '신혼희망타운' || it.kind === 'lh-newlywed' || /신혼희망/.test(n)) return 'newlywedHopeTown';
  if (it.typeName === '무순위') return 'noRank';
  if (it.typeName === '임의공급') return 'arbitrary';
  if (it.detailType === '국민' || it.source === 'lh') return 'publicSale';
  return 'private';
}

export const CATEGORY_LABEL = {
  equityShare: '지분적립형', newlywedHopeTown: '신혼희망타운', noRank: '무순위(줍줍)',
  arbitrary: '임의공급', publicSale: '공공분양', private: '민영',
};

function carValueAt(cars = [], date) {
  let total = 0, unknown = false;
  const detail = [];
  for (const c of cars) {
    if (c.inHousehold === false) continue;
    if (!c.registeredAt || date < c.registeredAt) { detail.push(`${c.name}: 공고일 기준 미등록(0원)`); continue; }
    const y = date.slice(0, 4);
    const v = c.values?.[y] ?? (y === c.registeredAt.slice(0, 4) ? c.values?.[y] ?? c.baseValue : null);
    if (v == null) { unknown = true; detail.push(`${c.name}: ${y}년 시가표준액 미입력`); continue; }
    total += v; detail.push(`${c.name}: ${won(v)}`);
  }
  return { total, unknown, detail };
}

function childrenAt(h, date) {
  // 출산 예정 자녀는 예정월이 공고일보다 앞서면 태어난 것으로 본다 (실제 출생 후 birth를 고쳐 넣기)
  return (h.children || []).filter(c => c.birth && bd(c.birth) <= date).length;
}

const bd = s => (s && s.length === 7 ? `${s}-01` : s); // 'YYYY-MM' 또는 'YYYY-MM-DD'
const yearsBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / (365.2425 * 864e5);
const addYears = (d, n) => `${+d.slice(0, 4) + n}${d.slice(4)}`;

/** 민영 일반공급 가점 (84점 만점): 무주택기간 32 + 부양가족 35 + 통장 가입기간 17 */
export function gajeom(h, date) {
  const ap = h.applicantInfo || {};
  // 무주택기간: 만 30세부터, 30세 전에 혼인했으면 혼인신고일부터
  let noHome = null;
  if (ap.birth) {
    const at30 = addYears(ap.birth, 30);
    const start = h.marriageDate && h.marriageDate < at30 ? h.marriageDate : at30;
    const s = [start, h.noHomeSince].filter(Boolean).sort().at(-1);
    if (s <= date) { const y = yearsBetween(s, date); noHome = y < 1 ? 2 : Math.min(32, 2 * Math.floor(y) + 2); } else noHome = 0;
  }
  // 부양가족: 배우자 + 자녀(태아 포함) + 3년 이상 같은 등본의 직계존속. 본인 제외
  const deps = (h.marriageDate && h.marriageDate <= date ? 1 : 0) + (h.children || []).length + (h.parentsDependents || 0);
  const family = Math.min(35, 5 + deps * 5);
  // 통장 가입기간
  const acc = h.accounts?.applicant;
  let bank = null;
  if (acc?.openedAt) { const y = yearsBetween(acc.openedAt, date); bank = y < 0.5 ? 1 : y < 1 ? 2 : Math.min(17, Math.floor(y) + 2); }
  return { noHome, family, deps, bank, total: noHome != null && bank != null ? noHome + family + bank : null };
}

function applicantChecks(it, h, date, cat, T, kids) {
  const out = [], push = (k, v, s) => out.push({ k, v, s });
  const pub = ['publicSale', 'equityShare', 'newlywedHopeTown'].includes(cat);

  // 소득: 가장 엄격한 특공 기준이 도시근로자 월평균소득 100% 수준. 그보다 낮으면 모든 특공 소득 기준 통과
  const inc = Object.values(h.monthlyIncome || {}).reduce((s, v) => s + (v || 0), 0);
  const size = Math.max(1, (h.marriageDate ? 2 : 1) + (h.children || []).filter(c => bd(c.birth) <= date && !c.expected).length);
  const base = T.urbanIncome100?.[Math.min(size, 5)];
  if (inc && base) {
    const pct = Math.round((inc / base) * 100);
    push('소득', `세대 월평균 ${won(inc)} = ${size}인 가구 도시근로자 소득의 ${pct}%${h.dualIncome ? ' (맞벌이)' : ' (외벌이)'} → ${pct <= 100 ? '가장 엄격한 특공 기준(100%)보다 낮아 신혼·생애최초·신생아 특공 소득 기준 모두 통과' : pct <= 130 ? '일부 특공은 소득 초과 가능, 공고문 표 확인' : '공공 특공 대부분 소득 초과, 민영은 추첨분만 가능'}`, pct <= 100 ? 'good' : pct <= 130 ? 'mid' : 'bad');
  } else push('소득', '세대 월평균 소득 미입력', 'mid');

  // 지역 우선순위: 신청자 기준
  const res = h.residence || {};
  if (res.sido && res.since) {
    const yrs = yearsBetween(res.since, date);
    const same = it.region && res.sido.startsWith(it.region);
    if (same) push('거주 지역', `${res.sido} ${Math.floor(yrs)}년 거주 → ${yrs >= 2 ? '해당지역 1순위 우선 (2년 이상)' : '해당지역이지만 2년 미만 → 규제지역은 기타지역 취급'}`, yrs >= 2 ? 'good' : 'mid');
    else push('거주 지역', `${res.sido} 거주 → ${it.region} 공고는 ${it.flags?.largeSite ? '대규모 택지: 수도권 기타지역 물량(통상 50%)으로 청약 가능' : '수도권 거주자로 청약 가능하지만 해당지역 거주자가 먼저 당첨'}`, 'mid');
  }

  // 청약통장
  const acc = h.accounts?.applicant;
  if (acc && (acc.paidCount || acc.recognizedAmount)) {
    const amt = acc.recognizedAmount || 0;
    if (pub) push('청약통장', `${acc.bank || ''} 납입 ${acc.paidCount ?? '?'}회 · 인정금액 ${won(amt)} → 국민주택 1순위(24회) ${acc.paidCount >= 24 ? '충족' : '확인 필요'}, 생애최초 저축액 600만 ${amt >= 6e6 ? '충족' : '미달'}`, acc.paidCount >= 24 && amt >= 6e6 ? 'good' : 'mid');
    else push('청약통장', `예치금 ${won(amt)} → 서울 기준 85㎡ 이하 300만·102㎡ 이하 600만·모든 면적 1500만 / ${amt >= 6e6 ? '102㎡ 이하까지 1순위 가능' : amt >= 3e6 ? '85㎡ 이하 가능' : '예치금 부족'}`, amt >= 3e6 ? 'good' : 'bad');
  } else push('청약통장', '신청자(아내) 통장 정보 미입력', 'mid');

  // 특별공급 유형별 자격 요약
  const types = [];
  const married7 = h.marriageDate && yearsBetween(h.marriageDate, date) <= 7;
  if (married7) types.push(`신혼부부(혼인 ${yearsBetween(h.marriageDate, date).toFixed(1)}년, 7년 이내 ~${addYears(h.marriageDate, 7).slice(0, 7)})`);
  const pregnantOrNewborn = (h.children || []).some(c => c.expected || (c.birth && yearsBetween(bd(c.birth), date) <= 2));
  if (pregnantOrNewborn) types.push('신생아(임신 중·2세 이하 자녀, 임신진단서 필요)');
  const firstLife = h.neverOwned && (h.incomeTaxYears?.applicant || 0) >= 5 && (married7 || kids || h.marriageDate) && h.householdHeadSince && h.householdHeadSince <= date;
  if (firstLife) types.push('생애최초(평생 무주택·소득세 5년·세대주)');
  if (types.length) push('특공 가능 유형', types.join(' / '), 'good');

  if (cat === 'private') {
    const g = gajeom(h, date);
    if (g.total != null) push('민영 가점', `무주택 ${g.noHome} + 부양가족 ${g.family}(${g.deps}명, 태아 포함) + 통장 ${g.bank} = ${g.total}점 / 84점`, g.total >= 50 ? 'good' : 'mid');
    else push('민영 가점', `무주택 ${g.noHome ?? '?'} + 부양가족 ${g.family}(${g.deps}명) + 통장 ${g.bank ?? '가입일 미입력'} → 일반공급은 추첨제 비중이 큰 85㎡ 초과·비규제 물량이 유리`, 'mid');
  }
  return out;
}

export function eligibility(it, h) {
  const cat = category(it);
  const date = it.noticeDate || it.window?.start || new Date().toISOString().slice(0, 10);
  if (!h) return { cat, status: '확인 필요', checks: [{ k: '세대 정보', v: '아직 입력 전', s: 'mid' }] };

  const T = thresholds(date.slice(0, 4));
  const a = h.assets || {};
  const car = carValueAt(a.cars, date);
  const kids = childrenAt(h, date);
  const total = (a.realEstate || 0) + (a.jeonseDeposit || 0) + (a.financial || 0) + car.total - (a.debt || 0);
  const checks = [];
  const push = (k, v, s) => checks.push({ k, v, s });

  push('무주택', '세대 전원 무주택 (입력값)', 'good');
  if (h.householdHeadSince && ['publicSale', 'private', 'equityShare'].includes(cat)) {
    const ok = h.householdHeadSince <= date;
    push('세대주', ok ? `공고일(${date}) 기준 세대주 (${h.householdHeadSince}~)` : `공고일(${date}) 당시 세대주 아님 → 생애최초·일반 1순위(규제지역) 불가`, ok ? 'good' : 'bad');
  }

  if (cat === 'publicSale' || cat === 'equityShare') {
    const base = T.publicSale; const rel = kids >= 2 ? base.birthRelief['2'] : kids === 1 ? base.birthRelief['1'] : null;
    const reLimit = rel?.realEstate ?? base.realEstate, carLimit = rel?.car ?? base.car;
    push('부동산가액', `${won(a.realEstate || 0)} / 기준 ${won(reLimit)}${rel ? ' (출산 완화)' : ''}`, (a.realEstate || 0) <= reLimit ? 'good' : 'bad');
    if (car.unknown) push('자동차가액', `${car.detail.join(', ')} → 1월에 홈택스 승용차 시가표준액 조회 후 입력 필요 / 기준 ${won(carLimit)}`, 'mid');
    else {
      const ratio = car.total / carLimit;
      push('자동차가액', `${car.detail.join(', ') || '0원'} / 기준 ${won(carLimit)}`, ratio <= 0.95 ? 'good' : ratio <= 1.05 ? 'mid' : 'bad');
    }
    push('적용 범위', '자산 기준은 특별공급과 전용 60㎡ 이하 일반공급에만 적용. 60㎡ 초과 일반공급은 자산 기준 없음', 'mid');
  }
  if (cat === 'equityShare') push('총자산', `${won(total)} → 지분적립형은 공고문 총자산 기준 확인 필요 (통상 3억대)`, total > 4e8 ? 'bad' : 'mid');
  if (cat === 'newlywedHopeTown') {
    const b = T.newlywedHopeTown; const lim = kids >= 2 ? b.birthRelief['2'] : kids === 1 ? b.birthRelief['1'] : b.totalAssetNet;
    // 차 가액을 모르는 해에는 차를 빼고 계산하면 통과로 잘못 나오므로, 기준 미만이어도 '확인 필요'로 둔다
    const s = total > lim ? 'bad' : car.unknown ? 'mid' : 'good';
    push('총자산', `${won(total)}${car.unknown ? ' + 자동차(가액 미입력)' : ''} (부동산+전세보증금+금융+자동차−부채) / 기준 ${won(lim)}${kids ? ' (출산 완화)' : ''}${car.unknown ? ` → 남은 여유 ${won(lim - total)}, 차량 시가표준액이 이보다 작아야 통과` : ''}`, s);
  }
  if (cat === 'private') {
    push('자산 기준', '민영 일반공급은 자산 기준 없음. 신혼·생애최초 특공 추첨분(소득 초과)은 부동산 3억3100만 이하', (a.realEstate || 0) <= T.privateSpecialLottery.realEstate ? 'good' : 'bad');
  }
  if (cat === 'noRank') push('자격', '무순위: 해당 지역(또는 전국) 무주택 세대구성원, 통장 불필요', 'good');
  if (cat === 'arbitrary') push('자격', '임의공급: 만 19세 이상 누구나, 통장 불필요. 당첨 시 주택 소유로 간주', 'good');
  if (!['noRank', 'arbitrary'].includes(cat)) for (const c of applicantChecks(it, h, date, cat, T, kids)) checks.push(c);

  const status = checks.some(c => c.s === 'bad') ? (cat === 'publicSale' ? '경계' : '불가') : checks.some(c => c.s === 'mid' && /자동차|총자산/.test(c.k)) ? '경계' : '가능';
  // 공공분양은 60㎡ 초과 일반공급으로 우회 가능하므로 '불가' 대신 '경계'
  return { cat, status, checks, totalAsset: total, kids };
}

// ── 2단계: 투자 ─────────────────────────────────────────────
export function acquisitionTax(p) {
  if (p <= 6e8) return p * 0.011;
  if (p <= 9e8) { const r = (p / 1e8) * (2 / 3) - 3; return p * (r / 100) * 1.1; }
  return p * 0.033;
}

export function invest(it, { models, location, market }) {
  const notes = [];
  const add = (k, v, s) => notes.push({ k, v, s });
  let plus = 0, minus = 0;

  // 안전마진: 대표 평형(84 근처 우선, 없으면 59 근처)
  const rows = market || [];
  const best = rows.filter(r => r.margin != null).sort((a, b) => Math.abs(a.area - 84) - Math.abs(b.area - 84))[0];
  let verdict;
  if (!best) {
    verdict = '조건부';
    add('안전마진', rows[0]?.comp?.reason || '비교 시세 부족 → 불확실', 'mid');
  } else {
    const m = best.margin;
    verdict = m >= 2e8 ? '추천' : m >= 1e8 ? '조건부' : '비추천';
    add('안전마진', `전용 ${best.area}㎡ 분양가 ${won(best.price)} + 취득세 ${won(best.tax)} vs 주변 시세 ${won(best.comp.estimate)} (반경 ${best.comp.radius / 1000}km·${best.comp.sample}건) → ${m >= 0 ? '+' : ''}${won(m)}`,
      m >= 2e8 ? 'good' : m >= 1e8 ? 'mid' : 'bad');
    if (best.comp.status === '표본 적음') add('시세 신뢰도', `비교 거래 ${best.comp.sample}건으로 적음`, 'mid');
    // 이상치 방어: 시세가 분양가의 1.6배를 넘으면 비교 단지가 잘못 잡혔을 가능성이 커서 추천을 막는다
    const ratio = best.comp.estimate / best.price;
    if (ratio > 1.6 || ratio < 0.6) {
      add('시세 이상치', `주변 시세가 분양가의 ${ratio.toFixed(1)}배 → 비교 단지가 다른 급지일 수 있음. 비교 단지 목록 확인 필요`, 'bad');
      if (verdict === '추천') verdict = '조건부';
    }
    if (best.comp.newTown) add('신도시 보정', '신도시·택지지구는 준공 5년 이내·분양권만 비교했어요. 아직 입주 전인 신도시의 미래 가치(교통·상권 완성)는 시세에 반영되지 않아 마진이 낮게 나올 수 있어요', 'mid');
    if (best.comp.complexes?.length === 1) add('시세 신뢰도', `비교 단지가 ${best.comp.complexes[0].name} 한 곳뿐`, 'mid');
  }

  if (location) {
    const st = location.subway?.[0];
    if (st && st.m <= 800) { plus++; add('지하철', `${st.name} ${st.m}m (도보 ${Math.round(st.m / 67)}분)`, 'good'); }
    else if (st) add('지하철', `가장 가까운 역 ${st.name} ${(st.m / 1000).toFixed(1)}km`, st.m <= 1500 ? 'mid' : 'bad');
    else { minus++; add('지하철', '반경 2km 안에 운행 중인 역 없음 (예정역은 공고문 확인)', 'bad'); }
    const el = location.elementary?.[0];
    if (el && el.m <= 400) { plus++; add('초등학교', `${el.name} ${el.m}m (초품아)`, 'good'); }
    else if (el) add('초등학교', `${el.name} ${el.m}m`, 'mid');
    else add('초등학교', '1.5km 안 초등학교 없음 (개교 예정 확인)', 'bad');
    if (location.academies1km >= 15) { plus++; add('학원가', '1km 안 학원 15곳 이상', 'good'); }
  }

  const units = it.totalUnits;
  if (units >= 1000) { plus++; add('규모', `${units.toLocaleString()}세대 대단지`, 'good'); }
  else if (units && units < 300 && !['noRank', 'arbitrary'].includes(category(it))) { minus++; add('규모', `${units}세대 소단지`, 'bad'); }

  const round = +(it.name.match(/\((\d+)차\)/)?.[1] || 0);
  if (['noRank', 'arbitrary'].includes(category(it))) {
    if (round >= 3) { minus++; add('반복 공급', `${round}차 공급 → 미분양 신호`, 'bad'); }
    else add('공급 사유', '계약취소분이면 최초 분양가라 기회, 미계약 잔여면 미분양 신호 (공고문 확인)', 'mid');
  }

  const f = it.flags || {};
  if (f.priceCap) add('규제', `분양가상한제${f.publicLand ? '·공공택지' : ''} → 실거주 의무·전매제한 기간 공고문 확인`, 'mid');
  if (f.speculativeZone) add('규제', '투기과열지구 → 재당첨 제한 10년·대출 규제', 'bad');
  if (category(it) === 'equityShare') { add('구조', '지분적립형: 차익은 보유 지분만큼만, 전매 10년', 'bad'); if (verdict === '추천') verdict = '조건부'; }
  if (category(it) === 'newlywedHopeTown') add('구조', '분양가가 총자산 기준 초과 시 수익공유형 모기지 의무 → 차익 일부 공유', 'mid');

  if (verdict === '추천' && minus > plus) verdict = '조건부';
  if (verdict === '조건부' && best && best.margin < 1.5e8 && minus >= 2) verdict = '비추천';
  return { verdict, margin: best?.margin ?? null, notes, plus, minus };
}

// ── 3단계: 출퇴근 ───────────────────────────────────────────
export function commuteVerdict(c) {
  if (!c?.avg) return { verdict: '확인 필요', text: '경로 계산 실패' };
  const v = c.avg <= 30 ? '가능' : c.avg <= 45 ? '애매' : '불가';
  return { verdict: v, text: `${c.date}(월) 08:00 출근 ${c.go?.min ?? '-'}분 · 18:30 퇴근 ${c.back?.min ?? '-'}분 · 평균 ${c.avg}분` };
}

export function overall(elig, inv, com) {
  const star = elig.status === '가능' && inv.verdict === '추천' && com.verdict === '가능';
  return { star, label: star ? '⭐ 강력 추천' : elig.status === '불가' ? '자격 불가' : inv.verdict };
}
