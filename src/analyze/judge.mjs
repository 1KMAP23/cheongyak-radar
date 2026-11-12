// docs/criteria.md 구현: 1) 자격 2) 투자 3) 출퇴근 → 종합
import { readFileSync } from 'node:fs';

const TH = JSON.parse(readFileSync(new URL('../../config/thresholds.json', import.meta.url)));
const won = n => (n == null ? '-' : n >= 1e8 ? `${(n / 1e8).toFixed(n % 1e8 ? 2 : 0).replace(/\.?0+$/, '')}억` : `${Math.round(n / 1e4).toLocaleString()}만`);
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
  return (h.children || []).filter(c => c.birth && `${c.birth}-01` <= date).length;
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
    push('총자산', `${won(total)} (부동산+전세보증금+금융+자동차−부채) / 기준 ${won(lim)}${kids ? ' (출산 완화)' : ''}`, total <= lim ? 'good' : 'bad');
  }
  if (cat === 'private') {
    push('자산 기준', '민영 일반공급은 자산 기준 없음. 신혼·생애최초 특공 추첨분(소득 초과)은 부동산 3억3100만 이하', (a.realEstate || 0) <= T.privateSpecialLottery.realEstate ? 'good' : 'bad');
  }
  if (cat === 'noRank') push('자격', '무순위: 해당 지역(또는 전국) 무주택 세대구성원, 통장 불필요', 'good');
  if (cat === 'arbitrary') push('자격', '임의공급: 만 19세 이상 누구나, 통장 불필요. 당첨 시 주택 소유로 간주', 'good');
  push('소득·청약통장', '공고문 표 기준 (세대 소득·아내 통장 정보 입력 후 자동 판정)', 'mid');

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
