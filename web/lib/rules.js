// 판정 규칙 (서버 Node와 아이폰 앱이 같이 쓰는 파일). docs/criteria.md와 같이 고칠 것.
// 세대 정보(h)는 각 기기 설정에서 오고, 서버 결과에는 세대 정보로 만든 내용을 넣지 않는다.

export const won = n => (n == null ? '-' : n === 0 ? '0원' : Math.abs(n) >= 1e8 ? `${(n / 1e8).toFixed(2).replace(/\.?0+$/, '')}억` : `${Math.round(n / 1e4).toLocaleString()}만`);

export const CATEGORY_LABEL = {
  equityShare: '지분적립형', newlywedHopeTown: '신혼희망타운', noRank: '무순위(줍줍)',
  arbitrary: '임의공급', publicSale: '공공분양', private: '민영',
};

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

  // 무순위·임의공급: 당첨되면 유주택자가 된다 → 생애최초·신혼 특공 기회가 사라진다
  if (cat === 'noRank' || cat === 'arbitrary') {
    push('자격', cat === 'noRank' ? '무순위: 무주택 세대구성원, 통장 불필요' : '임의공급: 만 19세 이상 누구나, 통장 불필요', 'good');
    const sp = specialTypes(h, date).out;
    push('당첨 시 주의', `당첨되면 유주택자가 돼요${sp.length ? ` → ${sp.join('·')} 특공 기회가 사라져요` : ''}. 줍줍 당첨은 재당첨 제한도 걸릴 수 있어요`, sp.length ? 'bad' : 'mid');
  } else for (const c of applicantChecks(it, h, date, cat, T)) checks.push(c);

  const hardBad = checks.filter(c => c.s === 'bad' && c.k !== '당첨 시 주의');
  let status;
  if (hardBad.length) status = cat === 'publicSale' && hardBad.every(c => /부동산|자동차/.test(c.k)) ? '경계' : '불가'; // 공공분양 자산 초과는 60㎡ 초과 일반공급으로 가능
  else if (checks.some(c => c.s === 'mid' && /자동차|총자산|세대주/.test(c.k)) || checks.some(c => c.k === '당첨 시 주의' && c.s === 'bad')) status = '경계';
  else status = '가능';
  return { cat, status, checks, totalAsset: total, kids };
}

/** 이름 옆에 붙는 짧은 태그: "❌ 자격 미달 (총자산)", "⚠️ 생애최초 포기" */
export function eligibilityTag(e) {
  if (e.status === '불가') return { icon: '❌', text: '자격 미달', why: [...new Set(e.checks.filter(c => c.s === 'bad').map(c => c.k))].join('·') };
  if (e.status !== '경계') return null;
  if (e.checks.some(c => c.k === '당첨 시 주의' && c.s === 'bad')) return { icon: '⚠️', text: '당첨 시 특공 기회 사라짐', why: '' };
  const why = [...new Set(e.checks.filter(c => c.s === 'bad' || (c.s === 'mid' && /자동차|총자산|세대주|부동산/.test(c.k))).map(c => c.k === '세대주' ? '생애최초 불가' : c.k))].join('·');
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
// 안전마진 40 + 출퇴근 30 + 입지 25(지하철 10·학군 10·규모 5) + 화제성 5. 자격은 점수에 넣지 않고 태그로 표시한다.
export function fitScore(it) {
  const parts = [];
  const inv = it.invest, m = inv.margin;
  let mv, mwhy;
  if (m == null) { mv = 12; mwhy = '시세 불확실'; }
  else if (inv.marginReliable === false) { mv = 12; mwhy = `${won(m)}로 나왔지만 시세 이상치라 불확실로 처리`; }
  else {
    mv = Math.max(0, Math.min(40, Math.round((m / 3e8) * 40)));
    mwhy = `${m >= 0 ? '+' : ''}${won(m)} (3억 이상 만점)`;
    if (inv.repeated && mv > 20) { mv = 20; mwhy += ` · ${inv.repeated}차 반복 공급이라 절반까지만`; }
  }
  parts.push({ k: '안전마진', v: mv, max: 40, why: mwhy });

  const c = it.commute?.avg;
  const cv = c == null ? 6 : c <= 20 ? 30 : c <= 30 ? 26 : c <= 40 ? 18 : c <= 45 ? 14 : c <= 60 ? 6 : 0;
  parts.push({ k: '출퇴근', v: cv, max: 30, why: c == null ? '경로 계산 안 됨' : `평균 ${c}분${it.commute.estimated ? '(추정)' : ''} · 20분 이내 만점` });

  const loc = it.location || {};
  const st = loc.subway?.[0];
  const sv = !st ? 0 : st.m <= 500 ? 10 : st.m <= 800 ? 8 : st.m <= 1200 ? 5 : st.m <= 2000 ? 2 : 0;
  const el = loc.elementary?.[0], ac = loc.academies1km ?? 0;
  const ev = !el ? 0 : el.m <= 300 ? 5 : el.m <= 500 ? 4 : el.m <= 800 ? 2 : 1;
  const av = ac >= 100 ? 5 : ac >= 50 ? 4 : ac >= 25 ? 3 : ac >= 10 ? 2 : ac >= 3 ? 1 : 0;
  const u = it.totalUnits;
  const uv = u == null ? 2 : u >= 1000 ? 5 : u >= 500 ? 3 : u >= 300 ? 2 : 0;
  const lv = it.geo ? sv + ev + av + uv : 5;
  parts.push({ k: '입지', v: lv, max: 25, why: it.geo
    ? [st ? `역 ${st.m.toLocaleString()}m ${sv}/10` : '역 없음 0/10', `학군 ${ev + av}/10 (${el ? `초교 ${el.m}m` : '초교 없음'}·학원 ${ac}곳)`, `규모 ${uv}/5${u ? ` (${u.toLocaleString()}세대)` : ''}`].join(' · ')
    : '위치를 못 찾아 기본점' });

  const hv = [0, 3, 5][it.hot || 0];
  parts.push({ k: '화제성', v: hv, max: 5, why: ['보통', '🔥 핫', '🔥🔥 매우 핫'][it.hot || 0] });
  return { total: parts.reduce((s, p) => s + p.v, 0), parts };
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
