// 판정 규칙 (서버 Node와 아이폰 앱이 같이 쓰는 파일). docs/criteria.md와 같이 고칠 것.
// 세대 정보(h)는 각 기기 설정에서 오고, 서버 결과에는 세대 정보로 만든 내용을 넣지 않는다.

export const won = n => (n == null ? '-' : n === 0 ? '0원' : Math.abs(n) >= 1e8 ? `${(n / 1e8).toFixed(2).replace(/\.?0+$/, '')}억` : `${Math.round(n / 1e4).toLocaleString()}만`);

export const CATEGORY_LABEL = {
  equityShare: '지분적립형', newlywedHopeTown: '신혼희망타운', noRank: '무순위(줍줍)',
  arbitrary: '임의공급', publicSale: '공공분양', private: '민영',
  officetel: '오피스텔', urban: '도시형생활주택', lodging: '생활숙박시설',
};
/** 일반 아파트가 아닌 상품 */
export const NON_APT = new Set(['officetel', 'urban', 'lodging']);

const bd = s => (s && s.length === 7 ? `${s}-01` : s); // 'YYYY-MM' 또는 'YYYY-MM-DD'
const yearsBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / (365.2425 * 864e5);
const addYears = (d, n) => `${+d.slice(0, 4) + n}${d.slice(4)}`;

export function pickThresholds(TH, year) {
  return TH[year] || TH[Object.keys(TH).filter(k => /^\d{4}$/.test(k)).sort().at(-1)];
}

function carValueAt(cars = [], date) {
  let total = 0, unknown = false;
  const detail = [];
  for (const c of cars) {
    if (c.inHousehold === false) continue;
    if (!c.registeredAt || date < c.registeredAt) { detail.push(`${c.name || '차량'}: 공고일 기준 미등록(0원)`); continue; }
    const y = date.slice(0, 4);
    const v = c.values?.[y] ?? (y === c.registeredAt.slice(0, 4) ? c.baseValue ?? null : null);
    if (v == null) { unknown = true; detail.push(`${c.name || '차량'}: ${y}년 시가표준액 미입력`); continue; }
    total += v; detail.push(`${c.name || '차량'}: ${won(v)}`);
  }
  return { total, unknown, detail };
}

// 출산 예정 자녀는 예정일이 공고일보다 앞서면 태어난 것으로 본다
const childrenAt = (h, date) => (h.children || []).filter(c => c.birth && bd(c.birth) <= date).length;

/** 민영 일반공급 가점 (84점 만점): 무주택기간 32 + 부양가족 35 + 통장 가입기간 17 */
export function gajeom(h, date) {
  const ap = h.applicantInfo || {};
  let noHome = null;
  if (ap.birth) {
    const at30 = addYears(ap.birth, 30);
    const start = h.marriageDate && h.marriageDate < at30 ? h.marriageDate : at30; // 30세 전에 혼인했으면 혼인일부터
    const s = [start, h.noHomeSince].filter(Boolean).sort().at(-1);
    if (s <= date) { const y = yearsBetween(s, date); noHome = y < 1 ? 2 : Math.min(32, 2 * Math.floor(y) + 2); } else noHome = 0;
  }
  const deps = (h.marriageDate && h.marriageDate <= date ? 1 : 0) + (h.children || []).length + (h.parentsDependents || 0);
  const family = Math.min(35, 5 + deps * 5);
  const acc = h.accounts?.applicant;
  let bank = null;
  if (acc?.openedAt) { const y = yearsBetween(acc.openedAt, date); bank = y < 0.5 ? 1 : y < 1 ? 2 : Math.min(17, Math.floor(y) + 2); }
  return { noHome, family, deps, bank, total: noHome != null && bank != null ? noHome + family + bank : null };
}

/** 이 공고일 기준으로 낼 수 있는 특별공급 종류 */
export function specialTypes(h, date) {
  const kids = childrenAt(h, date);
  const headOk = !!h.householdHeadSince && h.householdHeadSince <= date;
  const married7 = h.marriageDate && h.marriageDate <= date && yearsBetween(h.marriageDate, date) <= 7;
  const out = [], no = [];
  if (married7 || h.preMarriage) out.push(h.preMarriage && !married7 ? '신혼부부(예비)' : `신혼부부(혼인 ${yearsBetween(h.marriageDate, date).toFixed(1)}년)`);
  if ((h.children || []).some(c => c.expected && (!c.birth || bd(c.birth) > date)) || (h.children || []).some(c => c.birth && bd(c.birth) <= date && yearsBetween(bd(c.birth), date) <= 2)) out.push('신생아(임신·2세 이하)');
  if (kids >= 2) out.push(`다자녀(${kids}명)`);
  if ((h.parentsDependents || 0) > 0 && h.parentsOver65) out.push('노부모부양');
  const flBase = h.neverOwned && (h.incomeTaxYears?.applicant || 0) >= 5 && (h.marriageDate || kids || h.singleParent);
  if (flBase && headOk) out.push('생애최초');
  else if (flBase && !headOk) no.push(`생애최초 불가: 공고일(${date}) 당시 세대주 아님${h.householdHeadSince ? ` (세대주 ${h.householdHeadSince}~)` : ''}`);
  else if (!h.neverOwned) no.push('생애최초 불가: 과거 주택 소유 이력');
  else if ((h.incomeTaxYears?.applicant || 0) < 5) no.push('생애최초 불가: 신청자 소득세 5년 미만');
  return { out, no };
}

function applicantChecks(it, h, date, cat, T) {
  const out = [], push = (k, v, s) => out.push({ k, v, s });
  const pub = ['publicSale', 'equityShare', 'newlywedHopeTown'].includes(cat);

  // 소득: 가장 엄격한 특공 기준이 도시근로자 월평균소득 100% 수준
  const inc = Object.values(h.monthlyIncome || {}).reduce((s, v) => s + (+v || 0), 0);
  const size = Math.max(1, (h.marriageDate ? 2 : 1) + childrenAt(h, date) + (h.parentsDependents || 0));
  const base = T.urbanIncome100?.[Math.min(size, 5)];
  if (inc && base) {
    const pct = Math.round((inc / base) * 100);
    push('소득', `세대 월평균 ${won(inc)} = ${size}인 가구 도시근로자 소득의 ${pct}%${h.dualIncome ? ' (맞벌이)' : ''} → ${pct <= 100 ? '모든 특공 소득 기준 통과' : pct <= 130 ? '일부 특공 소득 초과 가능, 공고문 표 확인' : '공공 특공 대부분 소득 초과, 민영은 추첨분만'}`, pct <= 100 ? 'good' : pct <= 130 ? 'mid' : 'bad');
  } else push('소득', '세대 월평균 소득 미입력', 'mid');

  const res = h.residence || {};
  if (res.sido && res.since) {
    const yrs = yearsBetween(res.since, date);
    const same = it.region && res.sido.startsWith(it.region);
    if (same) push('거주 지역', `${res.sido} ${Math.floor(yrs)}년 거주 → ${yrs >= 2 ? '해당지역 우선 (2년 이상)' : '2년 미만 → 규제지역은 기타지역 취급'}`, yrs >= 2 ? 'good' : 'mid');
    else push('거주 지역', `${res.sido} 거주 → ${it.region} 공고는 ${it.flags?.largeSite ? '대규모 택지라 수도권 기타지역 물량으로 청약 가능' : '청약은 가능하지만 해당지역 거주자가 먼저 당첨'}`, 'mid');
  } else push('거주 지역', '거주지·전입일 미입력', 'mid');

  const acc = h.accounts?.applicant;
  if (acc && (acc.paidCount || acc.recognizedAmount)) {
    const amt = +acc.recognizedAmount || 0, n = +acc.paidCount || 0;
    if (pub) push('청약통장', `납입 ${n || '?'}회 · 인정금액 ${won(amt)} → 국민주택 1순위(24회) ${n >= 24 ? '충족' : '확인 필요'}, 생애최초 저축 600만 ${amt >= 6e6 ? '충족' : '미달'}`, n >= 24 ? 'good' : 'mid');
    else push('청약통장', `예치금 ${won(amt)} → ${amt >= 15e6 ? '모든 면적' : amt >= 6e6 ? '102㎡ 이하' : amt >= 3e6 ? '85㎡ 이하(서울 기준)' : '예치금 부족'} 1순위`, amt >= 3e6 ? 'good' : 'bad');
  } else push('청약통장', '신청자 통장 정보 미입력', 'mid');

  // 세대주: 생애최초와 규제지역 1순위만 세대주가 필요하다. 신혼·신생아 특공과 2순위는 세대주가 아니어도 된다
  const headOk = !!h.householdHeadSince && h.householdHeadSince <= date;
  if (['publicSale', 'private', 'equityShare'].includes(cat)) {
    if (headOk) push('세대주', `공고일 기준 세대주 (${h.householdHeadSince}~)`, 'good');
    else push('세대주', `공고일(${date}) 당시 세대주 아님 → 생애최초·${it.flags?.speculativeZone || it.flags?.adjustArea ? '규제지역 1순위 불가' : '일부 유형 불가'}. 신혼·신생아 특공, 2순위는 가능`, 'mid');
  }

  const sp = specialTypes(h, date);
  if (sp.out.length && cat !== 'newlywedHopeTown') push('특공 가능', sp.out.join(' · '), 'good');
  for (const n of sp.no) push('특공 불가', n, 'mid');

  if (cat === 'private') {
    const g = gajeom(h, date);
    push('민영 가점', g.total != null
      ? `무주택 ${g.noHome} + 부양가족 ${g.family}(${g.deps}명) + 통장 ${g.bank} = ${g.total}점 / 84`
      : `무주택 ${g.noHome ?? '?'} + 부양가족 ${g.family}(${g.deps}명) + 통장 ${g.bank ?? '가입일 미입력'} → 가점보다 특공·추첨제 물량이 유리`, g.total >= 50 ? 'good' : 'mid');
  }
  return out;
}

export function eligibility(it, h, TH) {
  const cat = it.category;
  const date = it.noticeDate || it.window?.start || new Date().toISOString().slice(0, 10);
  if (!h) return { cat, status: '확인 필요', checks: [{ k: '우리 집 정보', v: '설정에서 입력하면 자격까지 판정돼요', s: 'mid' }] };

  const T = pickThresholds(TH, date.slice(0, 4));
  const a = h.assets || {};
  const car = carValueAt(a.cars, date);
  const kids = childrenAt(h, date);
  const total = (+a.realEstate || 0) + (+a.jeonseDeposit || 0) + (+a.financial || 0) + car.total - (+a.debt || 0);
  const checks = [];
  const push = (k, v, s) => checks.push({ k, v, s });

  if (h.homeless === false) push('무주택', '세대원 중 집 가진 사람 있음 → 무주택 요건 공고 불가', cat === 'arbitrary' ? 'mid' : 'bad');
  else push('무주택', '세대 전원 무주택', 'good');
  if (h.recentWin) push('재당첨', '최근 당첨 이력 있음 → 재당첨 제한 기간 공고문 확인', 'bad');

  if (cat === 'publicSale' || cat === 'equityShare') {
    const base = T.publicSale; const rel = kids >= 2 ? base.birthRelief['2'] : kids === 1 ? base.birthRelief['1'] : null;
    const reLimit = rel?.realEstate ?? base.realEstate, carLimit = rel?.car ?? base.car;
    push('부동산가액', `${won(+a.realEstate || 0)} / 기준 ${won(reLimit)}${rel ? ' (출산 완화)' : ''}`, (+a.realEstate || 0) <= reLimit ? 'good' : 'bad');
    if (car.unknown) push('자동차가액', `${car.detail.join(', ')} → 홈택스 승용차 시가표준액 조회 후 입력 / 기준 ${won(carLimit)}`, 'mid');
    else { const r = car.total / carLimit; push('자동차가액', `${car.detail.join(', ') || '0원'} / 기준 ${won(carLimit)}`, r <= 0.95 ? 'good' : r <= 1.05 ? 'mid' : 'bad'); }
    push('적용 범위', '자산 기준은 특별공급·전용 60㎡ 이하 일반공급에만 적용. 60㎡ 초과 일반공급은 자산 기준 없음', 'mid');
  }
  if (cat === 'equityShare') push('총자산', `${won(total)} → 지분적립형은 공고문 총자산 기준 확인 (통상 3억대)`, total > 4e8 ? 'bad' : 'mid');
  if (cat === 'newlywedHopeTown') {
    const b = T.newlywedHopeTown; const lim = kids >= 2 ? b.birthRelief['2'] : kids === 1 ? b.birthRelief['1'] : b.totalAssetNet;
    const s = total > lim ? 'bad' : car.unknown ? 'mid' : 'good';
    push('총자산', `${won(total)}${car.unknown ? ' + 자동차(가액 미입력)' : ''} / 기준 ${won(lim)}${kids ? ' (출산 완화)' : ''}${car.unknown && total <= lim ? ` → 여유 ${won(lim - total)}, 차량 가액이 이보다 작아야 통과` : ''}`, s);
    const married7 = h.marriageDate && yearsBetween(h.marriageDate, date) <= 7;
    if (!married7 && !h.preMarriage && !kids && !(h.children || []).length) push('신혼 요건', '혼인 7년 이내·예비신혼·6세 이하 자녀 중 해당 없음', 'bad');
  }
  if (cat === 'private') push('자산 기준', '민영 일반공급은 자산 기준 없음 (특공 추첨분은 부동산 3억3100만 이하)', (+a.realEstate || 0) <= T.privateSpecialLottery.realEstate ? 'good' : 'bad');

  // 아파트가 아닌 상품: 청약통장 없이 누구나. 주택 수에 들어가는지가 핵심
  if (cat === 'officetel' || cat === 'lodging') {
    push('자격', `${CATEGORY_LABEL[cat]}: 청약통장 없이 만 19세 이상 누구나`, 'good');
    push('주택 수', cat === 'officetel' ? '오피스텔 분양권은 청약할 때 주택 수에 안 들어가 무주택이 유지돼요. 다만 주거용으로 쓰면 세금(취득세·양도세)에서는 주택으로 볼 수 있어요' : '생활숙박시설은 주택이 아니라 숙박시설이라 실거주(전입)가 막혀 있어요. 주거용으로 쓰면 이행강제금 대상이에요', cat === 'officetel' ? 'mid' : 'bad');
  } else if (cat === 'urban' || cat === 'noRank' || cat === 'arbitrary') {
    if (cat === 'urban') push('자격', '도시형생활주택: 청약통장 없이 만 19세 이상 누구나', 'good');
    if (cat !== 'urban') push('자격', cat === 'noRank' ? '무순위: 무주택 세대구성원, 통장 불필요' : '임의공급: 만 19세 이상 누구나, 통장 불필요', 'good');
    // 무순위는 지자체가 거주지를 제한할 수 있다 (예: 서울 공고는 서울 거주자만)
    const sido = h.residence?.sido;
    if (cat === 'noRank' && sido && it.region && !sido.startsWith(it.region)) push('거주지 제한', `${sido} 거주 → ${it.region} 무순위는 해당 지역 거주자로 제한되는 경우가 많아요. 공고문 '신청자격' 확인`, 'mid');
    const sp = specialTypes(h, date).out;
    push('당첨 시 주의', `당첨되면 유주택자가 돼요${cat === 'urban' ? '(도시형생활주택도 주택, 전용 20㎡ 이하 1채만 예외)' : ''}${sp.length ? ` → ${sp.join('·')} 특공 기회가 사라져요` : ''}${cat === 'urban' ? '' : '. 줍줍 당첨은 재당첨 제한도 걸릴 수 있어요'}`, sp.length ? 'bad' : 'mid');
  } else for (const c of applicantChecks(it, h, date, cat, T)) checks.push(c);

  const hardBad = checks.filter(c => c.s === 'bad' && c.k !== '당첨 시 주의');
  let status;
  if (hardBad.length) status = cat === 'publicSale' && hardBad.every(c => /부동산|자동차/.test(c.k)) ? '경계' : '불가'; // 공공분양 자산 초과는 60㎡ 초과 일반공급으로 가능
  else if (checks.some(c => c.s === 'mid' && /자동차|총자산|세대주|거주지 제한/.test(c.k)) || checks.some(c => c.k === '당첨 시 주의' && c.s === 'bad')) status = '경계';
  else status = '가능';
  return { cat, status, checks, totalAsset: total, kids };
}

/** 이름 옆에 붙는 짧은 태그: "❌ 자격 미달 (총자산)", "⚠️ 생애최초 포기" */
export function eligibilityTag(e) {
  if (e.status === '불가') return { icon: '❌', text: '자격 미달', why: [...new Set(e.checks.filter(c => c.s === 'bad').map(c => c.k))].join('·') };
  if (e.status !== '경계') return null;
  if (e.checks.some(c => c.k === '당첨 시 주의' && c.s === 'bad')) return { icon: '⚠️', text: '당첨 시 특공 기회 사라짐', why: '' };
  const why = [...new Set(e.checks.filter(c => c.s === 'bad' || (c.s === 'mid' && /자동차|총자산|세대주|부동산|거주지 제한/.test(c.k))).map(c => c.k === '세대주' ? '생애최초 불가' : c.k))].join('·');
  return { icon: '⚠️', text: '자격 일부 제한', why };
}

export function commuteVerdict(c, workplaceName = '직장') {
  if (!c?.avg) return { verdict: '확인 필요', text: `${workplaceName}까지 경로 계산 안 됨` };
  const v = c.avg <= 30 ? '가능' : c.avg <= 45 ? '애매' : '불가';
  const t = c.estimated ? `${workplaceName}까지 직선거리 기준 추정 약 ${c.avg}분` : `${workplaceName}까지 ${c.date}(월) 08:00 출근 ${c.go?.min ?? '-'}분 · 18:30 퇴근 ${c.back?.min ?? '-'}분 · 평균 ${c.avg}분`;
  return { verdict: v, text: t };
}

export function overall(elig, inv, com) {
  const star = elig.status === '가능' && inv.verdict === '추천' && com.verdict === '가능';
  return { star };
}

// ── 나에게 맞는 순서: 적합도 점수 (100점) ───────────────────
// 안전마진 40 + 출퇴근 30 + 입지 25(지하철 10·학군 10·규모 3·브랜드 2) + 화제성 5. 자격은 점수에 넣지 않고 태그로 표시한다.
export const DEFAULT_WEIGHTS = { margin: 40, commute: 20, location: 35, buzz: 5 };
/** 사용자가 정한 비율을 합 100으로 맞춘다 (빈 값·음수는 0) */
export function normWeights(w) {
  const k = ['margin', 'commute', 'location', 'buzz'];
  const v = Object.fromEntries(k.map(x => [x, Math.max(0, +(w?.[x] ?? DEFAULT_WEIGHTS[x]) || 0)]));
  const sum = k.reduce((s, x) => s + v[x], 0);
  if (!sum) return { ...DEFAULT_WEIGHTS };
  const out = Object.fromEntries(k.map(x => [x, Math.round(v[x] / sum * 100)]));
  out.margin += 100 - k.reduce((s, x) => s + out[x], 0); // 반올림 오차는 안전마진에
  return out;
}
export function fitScore(it, weights) {
  const W = normWeights(weights);
  const parts = [];
  // 각 항목을 0~1로 매긴 뒤 비율(W)을 곱한다
  const sc = (frac, max) => Math.round(Math.max(0, Math.min(1, frac)) * max * 10) / 10;
  const inv = it.invest;
  // 59㎡·84㎡(±8㎡) 중 믿을 수 있는 평형의 가장 큰 마진 (둘 다 없는 공고는 다른 평형으로).
  // 확인 못 한 마진은 6점(마진 약 0.45억 수준): 확인된 작은 마진보다 높게 치지 않는다
  const all = (it.market || []).filter(r => r.margin != null);
  const main = all.filter(r => Math.abs(r.area - 59) <= 8 || Math.abs(r.area - 84) <= 8);
  const rows = main.length ? main : all;
  const good = rows.filter(r => r.reliable !== false).sort((a, b) => b.margin - a.margin)[0];
  const m = good ? good.margin : null;
  let mv, mwhy;
  const exp = (it.market || []).filter(r => r.expMargin != null && (Math.abs(r.area - 59) <= 8 || Math.abs(r.area - 84) <= 8)).sort((a, b) => b.expMargin - a.expMargin)[0];
  if (!good && exp) { mv = exp.expMargin / 3e8; mwhy = `${Math.round(exp.area)}㎡ ${exp.expMargin >= 0 ? '+' : ''}${won(exp.expMargin)} (예상치: ${exp.expected.source})`; }
  else if (!good && rows.length) { mv = 0.15; mwhy = `${rows.map(r => `${Math.round(r.area)}㎡ ${won(r.margin)}`).join('·')}로 나왔지만 시세 비교 신뢰도가 낮아 불확실로 처리`; }
  else if (!good) { mv = 0.15; mwhy = '비교할 거래가 부족해 시세 불확실'; }
  else {
    mv = m / 3e8;
    mwhy = `${Math.round(good.area)}㎡ ${m >= 0 ? '+' : ''}${won(m)} (3억 이상 만점, 0 이하 0점)${main.length ? '' : ' · 59·84㎡가 없어 다른 평형 기준'}`;
    if (inv.repeated && mv > 0.5) { mv = 0.5; mwhy += ` · ${inv.repeated}차 반복 공급이라 절반까지만`; }
  }
  parts.push({ k: '안전마진', v: sc(mv, W.margin), max: W.margin, why: mwhy });

  const c = it.commute?.avg;
  const cv = c == null ? 0.2 : c <= 20 ? 1 : c <= 30 ? 0.87 : c <= 40 ? 0.6 : c <= 45 ? 0.47 : c <= 60 ? 0.2 : 0;
  parts.push({ k: '출퇴근', v: sc(cv, W.commute), max: W.commute, why: c == null ? '경로 계산 안 됨' : `평균 ${c}분${it.commute.estimated ? '(추정)' : ''} · 20분 이내 만점, 30분 87% · 40분 60% · 45분 47% · 60분 20%` });

  const loc = it.location || {};
  const st = loc.subway?.[0];
  const sv = !st ? 0 : st.m <= 500 ? 10 : st.m <= 800 ? 8 : st.m <= 1200 ? 5 : st.m <= 2000 ? 2 : 0;
  const el = loc.elementary?.[0], ac = loc.academies1km ?? 0;
  const ev = !el ? 0 : el.m <= 300 ? 5 : el.m <= 500 ? 4 : el.m <= 800 ? 2 : 1;
  const av = ac >= 100 ? 5 : ac >= 50 ? 4 : ac >= 25 ? 3 : ac >= 10 ? 2 : ac >= 3 ? 1 : 0;
  // totalUnits는 '이번 공고 공급 세대수'라 단지 전체 규모가 아니다. 무순위·임의공급(몇 세대)은 규모를 판단하지 않는다
  const u = it.totalUnits, few = ['noRank', 'arbitrary'].includes(it.category);
  const uv = few || u == null ? 1 : u >= 1000 ? 3 : u >= 500 ? 2 : u >= 300 ? 1 : 0;
  const br = brandOf(it);
  const bv = br ? 2 : 0;
  // 지하철 10 · 학군 10 · 규모 3 · 브랜드 2 = 25를 기준으로 비율만큼 늘이거나 줄인다
  const lv = it.geo ? (sv + ev + av + uv + bv) / 25 : 0.2;
  parts.push({ k: '입지', v: sc(lv, W.location), max: W.location, why: it.geo
    ? [st ? `역 ${st.m.toLocaleString()}m ${sv}/10` : '역 없음 0/10', `학군 ${ev + av}/10 (${el ? `초교 ${el.m}m` : '초교 없음'}·학원 ${ac}곳)`, `규모 ${uv}/3${few ? ' (잔여 물량이라 판단 안 함)' : u ? ` (공급 ${u.toLocaleString()}세대)` : ''}`, `브랜드 ${bv}/2${br ? ` (${br})` : ''}`].join(' · ')
    : '위치를 못 찾아 기본점' });

  const bz = it.buzzLevel ?? 0;
  parts.push({ k: 'SNS 화제', v: sc([0, 0.6, 1][bz], W.buzz), max: W.buzz, why: ['언급 보통', '블로그·카페 언급 많음', '언급 매우 많음'][bz] });
  return { total: Math.round(parts.reduce((s, p) => s + p.v, 0)), parts, weights: W };
}

/** 직장이 서버에 등록되지 않았을 때: 직선거리 × 1.35 ÷ 출근 시간대 평균 28km/h */
export function estimateCommute(geo, wp) {
  if (!geo || !wp?.x) return null;
  const R = 6371, toR = d => (d * Math.PI) / 180;
  const dLat = toR(wp.y - geo.y), dLng = toR(wp.x - geo.x);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(geo.y)) * Math.cos(toR(wp.y)) * Math.sin(dLng / 2) ** 2;
  const km = 2 * R * Math.asin(Math.sqrt(s)) * 1.35;
  return { avg: Math.round((km / 28) * 60 + 5), km: +km.toFixed(1), estimated: true };
}

// ── 브랜드: 시공능력평가 상위 10개사 (전문가들이 미분양 위험을 가르는 기준으로 자주 꼽음) ──
const BRANDS = [
  ['삼성물산', /삼성물산|래미안/], ['현대건설', /현대건설|힐스테이트|디에이치/], ['대우건설', /대우건설|푸르지오|써밋/],
  ['현대엔지니어링', /현대엔지니어링/], ['DL이앤씨', /DL이앤씨|디엘이앤씨|e편한세상|이편한세상|아크로/], ['GS건설', /GS건설|지에스건설|자이/],
  ['포스코이앤씨', /포스코|더샵|오티에르/], ['롯데건설', /롯데건설|롯데캐슬|르엘/], ['SK에코플랜트', /SK에코|에스케이에코|SK뷰/], ['HDC현대산업개발', /HDC|현대산업개발|아이파크/],
];
export function brandOf(it) {
  const t = `${it.builder || ''} ${it.name || ''}`;
  return BRANDS.find(([, re]) => re.test(t))?.[0] || null;
}

/** 10.15 대책 규제지역(서울 전역·경기 12곳): LTV 40%, 세대주만 1순위, 재당첨 10년 */
export function isRegulated(it, L) {
  if (it.flags?.speculativeZone || it.flags?.adjustArea) return true;
  const a = `${it.address || ''} ${it.region || ''}`;
  return (L?.regulatedAreas || []).some(r => r === '서울' ? /^서울|서울특별시/.test(a.trim()) || it.region === '서울' : r.split(' ').every(w => a.includes(w.replace(/시$/, ''))));
}

export function taxOf(p, firstHome) {
  const rate = p <= 6e8 ? 0.011 : p <= 9e8 ? (p / 1e8 * 2 / 3 - 3) / 100 + 0.001 : 0.033;
  const t = p * rate;
  return Math.max(0, firstHome && p <= 12e8 ? t - 2e6 : t);
}

/** 자금 계획: 계약금·잔금을 실제로 낼 수 있는지 (추정) */
export function funding(it, h, TH) {
  if (!h) return null;
  const date = it.noticeDate || it.window?.start || new Date().toISOString().slice(0, 10);
  const L = pickThresholds(TH, date.slice(0, 4))?.loan;
  const want = h.prefs?.areas?.length ? h.prefs.areas : [84];
  const ms = (it.models || []).filter(m => m.topPrice && m.exclusiveArea);
  if (!L || !ms.length) return null;
  const pick = ms.slice().sort((a, b) => Math.min(...want.map(w => Math.abs(a.exclusiveArea - w))) - Math.min(...want.map(w => Math.abs(b.exclusiveArea - w))) || a.topPrice - b.topPrice)[0];
  const price = pick.topPrice;
  const reg = isRegulated(it, L);
  const first = !!h.neverOwned && h.homeless !== false;
  const ltv = first ? L.ltv.firstHome : reg ? L.ltv.regulated : L.ltv.nonRegulated;
  const cap = L.capByPrice.find(([upTo]) => price <= upTo)[1];
  const inc = Object.values(h.monthlyIncome || {}).reduce((s, v) => s + (+v || 0), 0);
  const r = (L.rate + L.stress) / 12, n = L.years * 12;
  const dsrLoan = inc ? Math.round(inc * L.dsr * (1 - (1 + r) ** -n) / r) : null;
  const bankLoan = Math.min(price * ltv, cap, dsrLoan ?? Infinity);
  const a = h.assets || {};
  // 정책대출(DSR 미적용): 잔금 시점 기준으로 조건을 본다
  const soon = ['noRank', 'arbitrary'].includes(it.category) || (it.moveIn && Date.parse(`${it.moveIn.slice(0, 4)}-${it.moveIn.slice(4, 6) || '01'}-01`) - Date.parse(date) < 180 * 864e5);
  const payDate = soon ? new Date(Date.parse(date) + 60 * 864e5).toISOString().slice(0, 10) : it.moveIn ? `${it.moveIn.slice(0, 4)}-${it.moveIn.slice(4, 6) || '01'}-01` : date;
  const netAsset = (+a.realEstate || 0) + (+a.jeonseDeposit || 0) + (+a.financial || 0) - (+a.debt || 0);
  const policyTried = [];
  let policy = null;
  for (const p of L.policy || []) {
    const why = [];
    if (price > p.maxPrice) why.push(`집값 ${won(p.maxPrice)} 초과`);
    if (p.maxArea && pick.exclusiveArea > p.maxArea + 0.5) why.push(`전용 ${p.maxArea}㎡ 초과`);
    if (p.maxIncomeYear && inc * 12 > p.maxIncomeYear) why.push(`연소득 ${won(p.maxIncomeYear)} 초과`);
    if (p.maxNetAsset && netAsset > p.maxNetAsset) why.push(`순자산 ${won(p.maxNetAsset)} 초과`);
    if (p.firstHomeOnly && !first) why.push('생애최초 아님');
    if (p.babyWithinYears) {
      const ok = (h.children || []).some(c => c.birth && bd(c.birth) <= payDate && yearsBetween(bd(c.birth), payDate) <= p.babyWithinYears);
      if (!ok) why.push(`잔금 때(${payDate.slice(0, 7)}) ${p.babyWithinYears}년 안에 태어난 아이 없음`);
    }
    const amt = Math.min(p.cap, price * p.ltv);
    policyTried.push({ name: p.name, ok: !why.length, amt, why });
    if (!why.length && (!policy || amt > policy.amt)) policy = { name: p.name, amt };
  }
  const loan = Math.max(bankLoan, policy?.amt || 0);
  const tax = Math.round(taxOf(price, first));
  const now = Math.max(0, (+a.financial || 0) - (+a.debt || 0));
  const later = now + (+a.jeonseDeposit || 0);
  const need = Math.max(0, Math.round(price + tax - loan));
  const contract = Math.round(price * 0.1);
  // 무순위·임의공급은 보통 계약 후 1~2달 안에 잔금. 새 분양은 입주(2~3년 뒤)에 잔금이라 전세보증금을 쓸 수 있다
  const jeonseFree = !soon || (a.jeonseEnd && a.jeonseEnd <= payDate);
  const pool = jeonseFree ? later : now;
  let s, verdict;
  if (contract > now) { s = 'bad'; verdict = `계약금 ${won(contract)}부터 부족 (현금 ${won(now)})`; }
  else if (need <= pool) { s = 'good'; verdict = `잔금 가능 · 남는 돈 ${won(pool - need)}`; }
  else if (!jeonseFree && need <= later) { s = 'mid'; verdict = `전세보증금을 잔금 전에 돌려받아야 가능 (부족 ${won(need - now)})`; }
  else { s = 'bad'; verdict = `잔금 ${won(need - pool)} 부족`; }
  const lim = [
    `LTV ${Math.round(ltv * 100)}%${first ? '(생애최초)' : reg ? '(규제지역)' : ''} ${won(price * ltv)}`,
    `가격별 한도 ${won(cap)}`,
    dsrLoan != null ? `소득 기준(DSR 40%, 금리 ${((L.rate + L.stress) * 100).toFixed(1)}% 가정) ${won(dsrLoan)}` : '소득 미입력이라 소득 한도 계산 안 함',
  ];
  return {
    s, verdict, price, tax, loan, bankLoan, policy, need, now, later, soon, reg, area: Math.round(pick.exclusiveArea),
    lines: [
      { k: '기준 주택형', v: `전용 ${Math.round(pick.exclusiveArea)}㎡ 최고가 ${won(price)} + 취득세 약 ${won(tax)}${first ? '(생애최초 감면 반영)' : ''}`, s: 'mid' },
      { k: '은행 대출', v: `${won(bankLoan)} = ${lim.join(' · ')} 중 가장 작은 값`, s: policy && policy.amt > bankLoan ? 'mid' : 'good' },
      { k: '정책 대출', v: policyTried.map(p => p.ok ? `${p.name} 가능 ${won(p.amt)}` : `${p.name} 불가(${p.why.join(', ')})`).join(' / ') + (policy && policy.amt > bankLoan ? ` → ${policy.name}이 더 커서 이걸로 계산` : ''), s: policy ? 'good' : 'mid' },
      { k: '계약금', v: `분양가 10% ${won(contract)} · 지금 현금 ${won(now)}`, s: contract <= now ? 'good' : 'bad' },
      { k: '잔금 현금', v: `${won(need)} 필요 · ${jeonseFree ? `${soon ? '전세 만기가 잔금 전이라' : '입주 때'} 현금+전세보증금 ${won(later)} 기준` : `잔금(${payDate.slice(0, 7)})이 전세 만기 전이라 지금 현금 ${won(now)} 기준`}`, s },
      ...(reg ? [{ k: '규제지역', v: '주담대는 6개월 안에 전입해야 해요. 실거주 안 하고 전세를 놓으면 대출을 못 받아 잔금을 전세금으로 치러야 해요', s: 'mid' }] : []),
    ],
  };
}

/** 우리 집이 감당할 수 있는 최고 분양가 (84㎡ 기준, 규제지역 아님 가정). 새 분양(입주 2~3년 뒤)과 줍줍(잔금 곧) 두 가지 */
export function affordable(h, TH) {
  if (!h) return null;
  const y = new Date().getFullYear();
  const a = h.assets || {};
  const h2 = { ...h, assets: { ...a, financial: (+a.financial || 0) + (+a.jeonseDeposit || 0), jeonseDeposit: 0 } };
  const calc = (cat, moveIn, regulated, hh = h) => {
    let lo = 1e8, hi = 30e8;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      const f = funding({ category: cat, moveIn, region: regulated ? '서울' : '경기', address: regulated ? '서울' : '경기도', models: [{ exclusiveArea: 84, topPrice: mid }], noticeDate: new Date().toISOString().slice(0, 10) }, hh, TH);
      if (f && f.s === 'good') lo = mid; else hi = mid;
    }
    return Math.floor(lo / 1e6) * 1e6;
  };
  return { newSale: calc('private', `${y + 3}01`, false), soon: calc('noRank', null, false), soonWithJeonse: calc('noRank', null, false, h2),
    limitedByContract: (+a.financial || 0) - (+a.debt || 0) < calc('private', `${y + 3}01`, false) * 0.1 + 1e6 };
}

/** 🔥 핫 판정: 안전마진 기준. 믿을 수 있고(편차·이상치·경쟁률 검산 통과) 거래 5건 이상인 평형 중 가장 큰 마진. 2억 이상 🔥, 3억 이상 🔥🔥 */
export function marginHot(market) {
  const ok = (market || []).filter(r => r.margin != null && r.reliable && (r.comp?.sample || 0) >= 5);
  if (!ok.length) return { level: 0, why: '' };
  const best = ok.sort((a, b) => b.margin - a.margin)[0];
  const m = best.margin, level = m >= 3e8 ? 2 : m >= 2e8 ? 1 : 0;
  return { level, why: level ? `${Math.round(best.area)}㎡ 시세보다 ${won(m)} 싸요 (분양가가 시세의 ${Math.round(best.price / best.comp.estimate * 100)}%)` : '' };
}

/** 59㎡·84㎡ 기준 가격·마진 (±8㎡ 안에서 가장 가까운 주택형) */
export function sizeInfo(it, target) {
  const row = (it.market || []).filter(r => Math.abs(r.area - target) <= 8).sort((a, b) => Math.abs(a.area - target) - Math.abs(b.area - target))[0];
  const ms = (it.models || []).filter(m => m.topPrice && m.exclusiveArea && Math.abs(m.exclusiveArea - target) <= 8);
  if (!row && !ms.length) return null;
  const near = ms.length ? Math.min(...ms.map(m => Math.abs(m.exclusiveArea - target))) : null;
  const same = ms.filter(m => Math.abs(m.exclusiveArea - target) === near);
  const lo = same.length ? Math.min(...same.map(m => m.topPrice)) : row.price, hi = same.length ? Math.max(...same.map(m => m.topPrice)) : row.price;
  return { area: row?.area ?? Math.round(same[0].exclusiveArea * 10) / 10, lo, hi, margin: row?.margin ?? null, estimate: row?.comp?.estimate ?? null, reliable: row ? row.reliable !== false : true, method: row?.comp?.method, thin: row?.comp?.status === '거래 부족',
    expected: row?.expected || null, expMargin: row?.expMargin ?? null };
}

// ───────────────────────── 임대 ─────────────────────────
export const RENTAL_DEFAULT_WEIGHTS = { commute: 50, price: 20, location: 20, buzz: 10 };
export function normRentalWeights(w) {
  const k = ['commute', 'price', 'location', 'buzz'];
  const v = Object.fromEntries(k.map(x => [x, Math.max(0, +(w?.[x] ?? RENTAL_DEFAULT_WEIGHTS[x]) || 0)]));
  const sum = k.reduce((s, x) => s + v[x], 0);
  if (!sum) return { ...RENTAL_DEFAULT_WEIGHTS };
  const out = Object.fromEntries(k.map(x => [x, Math.round(v[x] / sum * 100)]));
  out.commute += 100 - k.reduce((s, x) => s + out[x], 0);
  return out;
}
const ageAt = (birth, date) => birth ? Math.floor(yearsBetween(bd(birth), date)) : null;
function householdSize(h, date) {
  const born = (h.children || []).filter(c => c.birth && bd(c.birth) <= date).length;
  return 1 + (h.marriageDate ? 1 : 0) + born + (+h.parentsDependents || 0);
}
function rentalAssets(h, date) {
  const a = h.assets || {};
  const yr = date.slice(0, 4);
  const cars = (a.cars || []).filter(c => c.inHousehold !== false && (!c.registeredAt || c.registeredAt <= date || true));
  const carVals = cars.map(c => +(c.values?.[yr] ?? c.values?.[+yr] ?? c.baseValue ?? 0) || 0);
  const total = (+a.realEstate || 0) + (+a.jeonseDeposit || 0) + (+a.financial || 0) + carVals.reduce((s, v) => s + v, 0) - (+a.debt || 0);
  return { total, maxCar: carVals.length ? Math.max(...carVals) : 0, carUnknown: cars.some(c => !c.values && !c.baseValue), realEstate: +a.realEstate || 0 };
}

/** 임대 공고 자격: 유형별 소득·자산·계층 */
export function rentalEligibility(it, h, TH) {
  if (!h) return { status: '확인 필요', checks: [{ k: '우리 집 정보', v: '설정에서 입력하면 임대 자격을 판정해요', s: 'mid' }] };
  const date = it.noticeDate || new Date().toISOString().slice(0, 10);
  const T = pickThresholds(TH, date.slice(0, 4)), R = T.rental;
  const checks = [], push = (k, v, s) => checks.push({ k, v, s });
  const type = it.rentalType;
  const size = householdSize(h, date);
  const inc = Object.values(h.monthlyIncome || {}).reduce((s, v) => s + (+v || 0), 0);
  const dual = +h.monthlyIncome?.applicant > 0 && +h.monthlyIncome?.partner > 0;
  const urban = T.urbanIncome100[String(Math.min(size, 5))];
  const A = rentalAssets(h, date);
  const kidsSince = (h.children || []).filter(c => c.birth && bd(c.birth) <= date && bd(c.birth) >= (R.national.childSince)).length;
  const pct = (v, base) => `${Math.round(v / base * 100)}%`;
  const incomeCheck = (limitPct, label = '소득') => {
    if (!inc) return push(label, '월소득 미입력 → 공고문 기준과 직접 비교', 'mid');
    const lim = urban * limitPct;
    push(label, `세대 월소득 ${won(inc)} (도시근로자 ${size}인 가구 평균의 ${pct(inc, urban)}) · 기준 ${Math.round(limitPct * 100)}% = ${won(lim)}`, inc <= lim ? 'good' : 'bad');
  };
  const assetCheck = (limit, car, label = '총자산') => {
    push(label, `${won(A.total)} (부동산+전세보증금+금융+자동차−부채) · 기준 ${won(limit)}`, A.total <= limit ? 'good' : 'bad');
    if (car != null) push('자동차', A.maxCar ? `가장 비싼 차 ${won(A.maxCar)} · 기준 ${won(car)}` : '차량 없음', A.maxCar <= car ? 'good' : 'bad');
  };
  if (h.homeless === false) push('무주택', '세대원 중 집이 있으면 공공임대 신청 불가', 'bad'); else push('무주택', '세대원 전원 무주택', 'good');

  const married7 = h.marriageDate && yearsBetween(h.marriageDate, date) <= 7;
  const kid6 = (h.children || []).some(c => c.birth && (c.expected || yearsBetween(bd(c.birth), date) <= 6));
  const age = ageAt(h.applicantInfo?.birth, date);

  if (type === '국민임대') {
    const i = Math.min(kidsSince, 2);
    incomeCheck(R.national.incomePctBySize[String(Math.min(size, 6))]);
    assetCheck(R.national.totalAsset[i], R.national.car[i]);
    if ((h.children || []).some(c => c.expected)) push('출산 후', `아이가 태어나면 총자산 기준이 ${won(R.national.totalAsset[Math.min(i + 1, 2)])}로 올라가요`, 'mid');
  } else if (type === '행복주택' || type === '행복주택(신혼희망)') {
    const nw = married7 || h.preMarriage || (h.singleParent && kid6) || kid6;
    if (nw) {
      const N = R.happy.newlywed;
      push('계층', `신혼부부·한부모 계층 (${married7 ? '혼인 7년 이내' : h.preMarriage ? '예비 신혼' : '6세 이하 자녀'})`, 'good');
      incomeCheck(dual ? N.incomePctDual : size === 2 ? N.incomePct2 : N.incomePct);
      if (type === '행복주택(신혼희망)') assetCheck(T.newlywedHopeTown.totalAssetNet, T.publicSale.car);
      else assetCheck(N.totalAsset, N.car);
    } else if (age != null && age >= R.happy.youth.ageMin && age <= R.happy.youth.ageMax && !h.marriageDate) {
      const Y = R.happy.youth;
      push('계층', `청년 계층 (만 ${age}세, 미혼)`, 'good');
      incomeCheck(size === 1 ? Y.incomePct1 : size === 2 ? Y.incomePct2 : Y.incomePct);
      assetCheck(Y.totalAsset, Y.car);
    } else if (age != null && age >= R.happy.elderly.ageMin) {
      push('계층', `고령자 계층 (만 ${age}세)`, 'good');
      incomeCheck(R.happy.elderly.incomePct); assetCheck(R.happy.elderly.totalAsset, R.happy.elderly.car);
    } else push('계층', '청년(19~39세 미혼)·신혼부부(혼인 7년 이내·6세 이하 자녀)·고령자(65세 이상) 중 해당 없음', 'bad');
  } else if (type === '통합공공임대') {
    const I = R.integrated, med = R.medianIncome[String(Math.min(size, 6))];
    const lim = (size === 1 ? I.medianPct1 : size === 2 ? I.medianPct2 : I.medianPct) * med;
    if (inc) push('소득', `세대 월소득 ${won(inc)} · 기준 중위소득 ${size}인 ${Math.round(lim / med * 100)}% = ${won(lim)}`, inc <= lim ? 'good' : 'bad');
    else push('소득', '월소득 미입력', 'mid');
    assetCheck(I.totalAsset, I.car);
  } else if (type === '공공임대') {
    incomeCheck(R.publicLease.incomePct);
    push('부동산', `${won(A.realEstate)} · 기준 ${won(R.publicLease.realEstate)}`, A.realEstate <= R.publicLease.realEstate ? 'good' : 'bad');
    push('자동차', A.maxCar ? `${won(A.maxCar)} · 기준 ${won(R.publicLease.car)}` : '차량 없음', A.maxCar <= R.publicLease.car ? 'good' : 'bad');
    push('청약통장', '분양전환 공공임대는 청약통장 순위로 뽑아요', 'mid');
  } else if (type === '영구임대') {
    push('계층', h.singleParent ? '한부모 가족은 영구임대 대상 계층일 수 있어요 → 공고문 확인' : '수급자·차상위·국가유공자·장애인·한부모 등 대상 계층만 신청할 수 있어요', h.singleParent ? 'mid' : 'bad');
  } else if (type === '장기전세') {
    const L = R.longJeonse;
    push('거주지', it.agency === 'SH' ? (h.residence?.sido === '서울' ? '서울 거주 → SH 장기전세 우선 대상' : '서울 거주자 우선이라 당첨이 어려워요') : '공고 지역 거주자 우선', it.agency === 'SH' && h.residence?.sido !== '서울' ? 'mid' : 'good');
    incomeCheck(dual ? L.incomePctSmallDual : L.incomePctSmall, '소득(60㎡ 이하)');
    push('소득(60㎡ 초과)', `기준 ${Math.round((dual ? L.incomePctMidDual : L.incomePctMid) * 100)}% = ${won(urban * (dual ? L.incomePctMidDual : L.incomePctMid))}`, inc && inc <= urban * (dual ? L.incomePctMidDual : L.incomePctMid) ? 'good' : 'mid');
    push('자산', `총자산 ${won(A.total)} · 장기전세 자산 기준은 공고마다 달라요 → 공고문 확인`, 'mid');
    if (married7) push('신혼 우선', '혼인 7년 이내라 신혼부부 우선공급(미리내집) 대상일 수 있어요', 'good');
  } else if (type === '청년안심주택') {
    const youth = age != null && age >= 19 && age <= 39;
    push('계층', youth ? `청년(만 ${age}세)·신혼부부 대상 → ${married7 ? '신혼부부로 신청 가능' : '청년으로 신청 가능'}` : married7 ? '신혼부부 유형으로 신청 가능' : '만 19~39세 청년·신혼부부 대상', youth || married7 ? 'good' : 'bad');
    push('소득·자산', '공공임대분·민간임대분 기준이 달라요 → 공고문 확인', 'mid');
  } else if (type === '공공지원민간임대') {
    push('자격', '일반공급은 무주택이면 소득 상관없이 신청 가능. 특별공급(청년·신혼 등)은 소득 120% 등 기준 있음', 'good');
  } else {
    push('자격', '세부 자격은 공고문 확인', 'mid');
  }
  const bad = checks.filter(c => c.s === 'bad');
  const status = bad.length ? '불가' : checks.some(c => c.s === 'mid') ? '경계' : '가능';
  return { status, checks, size, totalAsset: A.total };
}
export function rentalTag(e) {
  if (!e || e.status === '확인 필요') return null;
  if (e.status === '불가') return { icon: '❌', text: '자격 미달', why: [...new Set(e.checks.filter(c => c.s === 'bad').map(c => c.k))].join('·') };
  if (e.status === '가능') return { icon: '✅', text: '자격 됨', why: '' };
  return { icon: '⚠️', text: '확인 필요', why: [...new Set(e.checks.filter(c => c.s === 'mid').map(c => c.k))].slice(0, 2).join('·') };
}

/** 임대 점수: 출퇴근 50 · 매매 가격대 20 · 입지 20 · SNS 10 (사용자 비율 가능) */
export function rentalFit(it, weights) {
  const W = normRentalWeights(weights);
  const sc = (frac, max) => Math.round(Math.max(0, Math.min(1, frac)) * max * 10) / 10;
  const parts = [];
  const c = it.commute?.avg;
  const cv = c == null ? 0.2 : c <= 20 ? 1 : c <= 30 ? 0.87 : c <= 40 ? 0.6 : c <= 45 ? 0.47 : c <= 60 ? 0.2 : 0;
  parts.push({ k: '출퇴근', v: sc(cv, W.commute), max: W.commute, why: c == null ? '경로 계산 안 됨' : `평균 ${c}분 · 20분 이내 만점` });
  // 주변 아파트 매매가 수준: 평당 1,500만 0점 → 5,000만 만점 (비싼 동네일수록 입지가 좋다고 본다)
  const pp = it.priceLevel?.perPyeong;
  const pv = pp ? (pp - 1.5e7) / 3.5e7 : 0.3;
  parts.push({ k: '매매 가격대', v: sc(pv, W.price), max: W.price, why: pp ? `주변 아파트 평당 ${won(pp)}${it.priceLevel.at59 ? ` (59㎡ 약 ${won(it.priceLevel.at59)})` : ''} · 평당 5,000만 이상 만점` : '주변 거래 부족 → 기본 30%' });
  const L = it.location || {};
  const st = L.subway?.[0]?.m, el = L.elementary?.[0]?.m, ac = L.academies1km ?? 0;
  const sv = st == null ? 0 : st <= 500 ? 10 : st <= 800 ? 8 : st <= 1200 ? 5 : st <= 2000 ? 2 : 0;
  const ev = (el == null ? 0 : el <= 300 ? 5 : el <= 600 ? 4 : el <= 1000 ? 2 : 0) + (ac >= 100 ? 5 : ac >= 50 ? 4 : ac >= 20 ? 3 : ac >= 5 ? 1 : 0);
  parts.push({ k: '입지', v: sc(it.geo ? (sv + ev) / 20 : 0.2, W.location), max: W.location, why: it.geo ? `역 ${st != null ? st.toLocaleString() + 'm' : '2km 밖'} · 초교 ${el != null ? el + 'm' : '-'} · 학원 ${ac}곳` : '위치 확인 안 됨' });
  const bz = it.buzzLevel ?? 0;
  parts.push({ k: 'SNS 화제', v: sc([0, 0.6, 1][bz], W.buzz), max: W.buzz, why: ['언급 보통', '언급 많음', '언급 매우 많음'][bz] });
  return { total: Math.round(parts.reduce((s, p) => s + p.v, 0)), parts, weights: W };
}

/** 주택형(전용면적)별 분양가·시세·안전마진. 같은 면적의 A/B 타입은 한 줄로 묶는다.
 *  마진 = 시세(실거래, 없으면 예상치) − 그 타입 분양가 − 취득세 − 발코니 확장비(전용 ㎡당 20만) */
export function typeRows(it) {
  const g = new Map();
  for (const m of it.models || []) {
    if (!m.topPrice || !m.exclusiveArea) continue;
    const k = Math.round(m.exclusiveArea);
    const e = g.get(k) || { area: k, exact: m.exclusiveArea, lo: Infinity, hi: 0, types: [], pyeong: m.pyeong };
    e.lo = Math.min(e.lo, m.topPrice); e.hi = Math.max(e.hi, m.topPrice); e.types.push(m.type); g.set(k, e);
  }
  const marginAt = (est, price, area) => est ? Math.round(est - price - taxOf(price, false) - Math.round(area * 2e5 / 1e5) * 1e5) : null;
  return [...g.values()].sort((a, b) => a.area - b.area).map(e => {
    const row = (it.market || []).filter(r => Math.abs(r.area - e.area) <= 1.5).sort((a, b) => Math.abs(a.area - e.area) - Math.abs(b.area - e.area))[0];
    const real = row?.comp?.estimate || null, reliable = row ? row.reliable !== false : null;
    const exp = row?.expected?.estimate || null;
    const useExp = (!real || !reliable) && exp;
    const est = useExp ? exp : real;
    return { ...e, estimate: est, expected: !!useExp, reliable: useExp ? true : reliable, thin: row?.comp?.status === '거래 부족',
      marginHi: marginAt(est, e.hi, e.exact), marginLo: marginAt(est, e.lo, e.exact), method: useExp ? row.expected.source : row?.comp?.method || null };
  });
}
