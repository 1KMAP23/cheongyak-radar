// 서버 쪽 판정: 세대 정보와 상관없는 것(분류·투자·지역 표시). 자격·점수 규칙은 web/lib/rules.js (앱과 공용)
import { readFileSync } from 'node:fs';
import { won, CATEGORY_LABEL } from '../../web/lib/rules.js';
export * from '../../web/lib/rules.js';
export const TH = JSON.parse(readFileSync(new URL('../../config/thresholds.json', import.meta.url)));

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
  let verdict, unreliable = false;
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
      unreliable = true;
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
  if (unreliable && verdict === '조건부' && best.margin >= 2e8) add('판정', '마진은 크게 나왔지만 비교 단지가 맞지 않을 수 있어 조건부로 낮췄어요', 'mid');
  return { verdict, margin: best?.margin ?? null, marginReliable: !unreliable, repeated: ['noRank', 'arbitrary'].includes(category(it)) && round >= 3 ? round : 0, notes, plus, minus };
}

/** 단지 이름 앞에 붙일 지역: 서울·인천은 "서울 중화", 경기는 "용인 마북" */
export function placeLabel(it) {
  const a = (it.geo?.address || it.address || '').replace(/\(.*?\)/g, ' ').split(/\s+/).filter(Boolean);
  const sido = (a[0] || it.region || '').replace(/특별시|광역시|특별자치시|특별자치도|도$/, '').replace('경기', '경기');
  const city = a.find((w, i) => i > 0 && /시$/.test(w))?.replace(/시$/, '');
  const dong = a.find(w => /(동|읍|면|가)$/.test(w) && !/(^|\s)(구|시)$/.test(w))?.replace(/\d*가$/, '').replace(/\d*동$/, '').replace(/(읍|면)$/, '');
  if (!a.length) {
    const m = it.name.match(/\(([^)]*?(서울|수원|용인|광교|안성|고양|시흥|남양주|인천)[^)]*)\)/);
    return m ? m[1].replace(/·/g, ' ') : (it.region || '');
  }
  const gu = a.find((w, i) => i > 0 && /구$/.test(w))?.replace(/구$/, '');
  const head = /^(서울|인천)/.test(sido) ? sido.slice(0, 2) : (city || sido.slice(0, 2));
  const tail = dong && dong !== head ? dong : (/^(서울|인천)/.test(sido) ? gu : null);
  return [head, tail].filter(Boolean).join(' ');
}

/** 목록용 짧은 이름: 공고 문구를 걷어낸다 (상세 화면은 원래 이름) */
export function shortName(name) {
  return name
    .replace(/\[정정공고\]/g, '')
    .replace(/\((공공분양|본청약|공공분양주택)\)/g, '')
    .replace(/(잔여세대\s*)?(추가\s*)?입주자\s*모집\s*공고(\([^)]*\))?/g, '')
    .replace(/공공분양주택/g, '공공분양')
    .replace(/\s+/g, ' ').trim() + (/잔여세대/.test(name) ? ' 잔여' : '');
}
