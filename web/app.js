// 청약 레이더 웹앱: 잠금 해제 → 목록 → 단지별 분석 페이지 → 공고문 원문 링크
// 자격·점수는 이 기기에 저장된 '우리 집 정보'로 계산한다 (서버 데이터에는 세대 정보가 없다)
import { won, eligibility, eligibilityTag, commuteVerdict, overall, fitScore, brandOf, sizeInfo, normWeights } from './lib/rules.js';
import { householdView } from './household.js';
const VAPID_PUBLIC = 'BDGbFHT5-WKQMTzp1Y_tj_5ByKKSqmjqoVrW-P67Yf2_EUMiaAS6Xabst53usz-kz1tCr6UA8OA_vk-gl47xPCA';
const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: k => { try { localStorage.removeItem(k); } catch {} } };
const md = s => s ? s.slice(5).replace('-', '/').replace(/^0/, '').replace('/0', '/') : '';
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
let RAW = null, R = null, filter = store.get('cy-filter') || 'all';
const loadHH = () => { try { return JSON.parse(store.get('cy-household') || 'null'); } catch { return null; } };

/** 서버 데이터 + 이 기기의 우리 집 정보 → 화면용 데이터 */
function enrich(raw) {
  const HH = loadHH();
  const wps = raw.workplaces || [];
  // 직접 입력한 직장은 주소 대신 익명 ID(workplaceId)로 출퇴근 데이터를 찾는다
  const wp = HH?.prefs?.workplaceId ? { id: HH.prefs.workplaceId, name: HH.prefs.workplaceName || '내 직장', custom: true }
    : HH ? wps.find(w => w.id === HH.prefs?.workplace) || null : wps[0] || null;
  const weights = HH?.prefs?.weights;
  const regions = HH?.prefs?.regions?.length ? HH.prefs.regions : null;
  const items = [];
  let hidden = 0, ended = 0;
  const today = kstToday();
  for (const src of raw.items) {
    if (regions && !regions.some(r => (src.region || '').startsWith(r))) { hidden++; continue; }
    // 주말·공휴일엔 새 데이터가 없어서, 이미 접수가 끝난 공고는 여기서 뺀다
    if (src.window?.end && src.window.end < today) { ended++; continue; }
    const it = { ...src, closingToday: src.window?.end === today };
    it.commute = wp ? src.commutes?.[wp.id] || null : null;
    it.eligibility = eligibility(it, HH, raw.thresholds);
    it.commuteResult = !wp ? { verdict: '확인 필요', text: '설정에서 직장을 고르면 출퇴근 시간을 계산해요' }
      : wp.custom && !it.commute ? { verdict: '확인 필요', text: '직장 등록 중 · 다음 평일 아침 분석부터 출퇴근 시간이 나와요' }
      : commuteVerdict(it.commute, wp.name);
    it.overall = overall(it.eligibility, it.invest, it.commuteResult);
    it.fit = fitScore(it, weights);
    it.eligTag = eligibilityTag(it.eligibility);
    const minPrice = Math.min(...(it.models || []).map(m => m.topPrice).filter(Boolean));
    it.overBudget = HH?.prefs?.maxPrice && isFinite(minPrice) && minPrice > HH.prefs.maxPrice;
    items.push(it);
  }
  // 추천 점수(적합도) 순. 동점이면 마감이 빠른 순
  items.sort((a, b) => (b.fit.total - a.fit.total) || (a.window?.end || '').localeCompare(b.window?.end || ''));
  items.forEach((it, i) => (it.rank = i + 1));
  const count = f => items.filter(f).length;
  const stale = Date.now() - Date.parse(raw.generatedAt) > 20 * 3600e3;
  return { ...raw, items, HH, wp, hidden, ended, today, stale,
    summary: { total: items.length, star: count(i => i.overall.star), recommend: count(i => i.invest.verdict === '추천'), conditional: count(i => i.invest.verdict === '조건부'), notRecommend: count(i => i.invest.verdict === '비추천'), hot: count(i => i.hot > 0) } };
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// ── 복호화 ──
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function decrypt(pass) {
  const r = await fetch(`data.enc.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error('nodata');
  const e = await r.json();
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(e.salt), iterations: e.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(e.iv) }, key, b64(e.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}

function lockView(msg = '') {
  app.innerHTML = `<div class="wrap"><form class="lock" id="lock">
    <img src="apple-touch-icon.png" alt="" width="64" height="64" style="margin:0 auto;border-radius:14px">
    <h1>청약 레이더</h1><p class="sub">처음 한 번만 비밀번호를 넣으면 이 기기에 기억해요.</p>
    <input id="pass" type="password" inputmode="numeric" autocomplete="current-password" placeholder="비밀번호" required>
    <div class="err" id="err">${esc(msg)}</div>
    <button class="primary" type="submit">열기</button></form></div>`;
  document.getElementById('lock').addEventListener('submit', async ev => {
    ev.preventDefault();
    const p = document.getElementById('pass').value.trim();
    document.getElementById('err').textContent = '여는 중…';
    try { RAW = await decrypt(p); R = enrich(RAW); store.set('cy-pass', p); route(); }
    catch (e) { document.getElementById('err').textContent = e.message === 'nodata' ? '아직 오늘 데이터가 없어요. 잠시 후 다시 열어 주세요.' : '비밀번호가 맞지 않아요.'; }
  });
}

async function boot() {
  try { CONFIG = await (await fetch('config.json', { cache: 'no-store' })).json(); } catch { CONFIG = {}; }
  // 동의한 사람은 하루 한 번 최신 설정·알림 정보를 다시 보낸다 (알림 정보는 가끔 바뀐다)
  const hh = loadHH(), last = store.get('cy-synced');
  if (hh?.shareConsent && last !== kstToday()) { syncShare(hh); store.set('cy-synced', kstToday()); }
  const p = store.get('cy-pass');
  if (!p) return lockView();
  try { RAW = await decrypt(p); R = enrich(RAW); route(); }
  catch (e) { if (e.message === 'nodata') app.innerHTML = '<div class="wrap"><p class="sub">오늘 데이터가 아직 없어요. 잠시 후 다시 열어 주세요.</p></div>'; else { store.del('cy-pass'); lockView('비밀번호가 바뀌었어요. 다시 넣어 주세요.'); } }
}

// ── 공통 조각 ──
const vpill = (label, v) => `<span class="pill v-${esc(String(v).replace(/\s/g, ''))}">${esc(label)} ${esc(v)}</span>`;
function schedule(it) {
  const s = it.schedule || {}, out = [];
  const f = (l, a) => a && a[0] && out.push(`${l} ${md(a[0])}${a[1] && a[1] !== a[0] ? '~' + md(a[1]) : ''}`);
  f('특공', s.special); f('1순위', s.rank1); f('2순위', s.rank2); f('접수', s.single);
  if (!out.length && it.window) out.push(`${md(it.window.start)}~${md(it.window.end)}`);
  return out.join(' · ');
}
const priceRange = it => { const p = (it.models || []).map(m => m.topPrice).filter(Boolean); if (!p.length) return ''; const a = Math.min(...p), b = Math.max(...p); return a === b ? won(a) : `${won(a)}~${won(b)}`; };
const areaRange = it => { const a = (it.models || []).map(m => Math.round(m.exclusiveArea)).filter(Boolean); if (!a.length) return ''; const lo = Math.min(...a), hi = Math.max(...a); return `전용 ${lo === hi ? lo : `${lo}~${hi}`}㎡`; };

// ── 목록 ──
const FILTERS = [
  ['all', '전체', () => true],
  ['today', '⏰ 오늘 마감', it => it.closingToday],
  ['new', '📢 새 공고', it => isNew(it)],
  ['soon', '📅 접수 예정', it => it.window?.start > R.today],
  ['ok', '자격 됨', it => it.eligibility.status !== '불가'],
  ['near', '🚗 45분 이내', it => it.commuteResult.verdict === '가능' || it.commuteResult.verdict === '애매'],
  ['rec', '투자 추천', it => it.invest.verdict === '추천'],
  ['hot', '🔥 시세보다 2억+ 싼 곳', it => it.hot > 0],
  ['star', '⭐ 강력 추천', it => it.overall.star],
];
const match = it => (FILTERS.find(f => f[0] === filter) || FILTERS[0])[2](it);
function nextStep(it) {
  const s = it.schedule || {}, t = R.today;
  const steps = [['특공', s.special], ['1순위', s.rank1], ['2순위', s.rank2], ['접수', s.single]].filter(([, a]) => a && a[0]);
  const nx = steps.find(([, a]) => (a[1] || a[0]) >= t);
  if (!nx) return it.window ? `접수 ${md(it.window.start)}~${md(it.window.end)}` : '';
  const [l, [a, b]] = nx;
  return a === t || (a <= t && (b || a) >= t) ? `${l} 오늘${b && b !== t ? `~${md(b)}` : ''}` : `${l} ${md(a)}${b && b !== a ? '~' + md(b) : ''}`;
}
function listView() {
  const W = normWeights(R.HH?.prefs?.weights);
  const shown = FILTERS.filter(([k, , f]) => k === 'all' || k === filter || R.items.some(f));
  const items = R.items.filter(match);
  // 오늘 마감은 맨 위에 따로, 나머지는 적합도 순. 자격 미달도 빼지 않고 ❌ 태그로 표시
  const banners = [
    R.warnings.length && `<div class="banner warn">⚠️ ${R.warnings.map(esc).join('<br>')}</div>`,
    R.stale && `<div class="banner warn">마지막 분석이 ${new Date(R.generatedAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}이에요. 주말·공휴일엔 갱신이 없어요. 접수 끝난 공고 ${R.ended}건은 뺐어요.</div>`,
    !R.HH && '<a class="banner info" href="#settings"><b>⚙︎ 설정에서 우리 집 정보를 입력해 주세요 →</b><br><span class="sub">자격(❌·⚠️)·출퇴근·추천 순위가 우리 집 기준으로 바뀌어요.</span></a>',
  ].filter(Boolean).join('');
  app.innerHTML = `<div class="wrap">
    <div class="top"><div><h1>청약 레이더</h1><p class="sub">${new Date(R.generatedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })} 업데이트 · ${R.items.length}건</p></div>
      <span class="topbtns"><a class="btn" href="#settings" aria-label="설정">⚙︎ 설정</a></span></div>
    ${banners}
    <div class="chips scroll" role="group" aria-label="필터">${shown.map(([k, l, f]) => `<button class="chip" data-f="${k}" aria-pressed="${filter === k}">${l} <b class="mono">${R.items.filter(f).length}</b></button>`).join('')}</div>
    <h2 class="sec">👍 추천 순위 <a class="sub" href="#settings">마진 ${W.margin} · 출퇴근 ${W.commute} · 입지 ${W.location} · SNS ${W.buzz} ✎</a></h2>
    <div class="list">${items.length ? items.map(card).join('') : '<p class="sub">조건에 맞는 공고가 없어요.</p>'}</div>
    <p class="sub">청약홈 ${R.sources?.applyhome?.ok === false ? '수집 실패' : '전체'} + LH 단독 공고 ${R.crossCheck?.onlyLH?.length ?? 0}건 포함${R.hidden ? ` · 관심 지역 밖 ${R.hidden}건 숨김` : ''}.<br>투자 자문이 아닌 참고 자료예요. 자격·금액은 반드시 공고문 원문으로 확인하세요.</p>
  </div>`;
  app.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', () => { filter = b.dataset.f; store.set('cy-filter', filter); listView(); }));
}
const etag = it => it.eligTag ? `<span class="etag ${it.eligTag.icon === '❌' ? 'no' : 'warn'}">${it.eligTag.icon} ${esc(it.eligTag.text)}${it.eligTag.why ? `<small> (${esc(it.eligTag.why)})</small>` : ''}</span>` : '';
const dday = d => Math.round((Date.parse(d) - Date.parse(R.today)) / 864e5);
const dueTag = it => it.closingToday ? '<span class="etag no">⏰ 오늘 마감</span>'
  : it.window?.start > R.today ? `<span class="tag mono">접수 D-${dday(it.window.start)}</span>`
  : it.window?.end ? `<span class="tag mono">마감 D-${dday(it.window.end)}</span>` : '';
const isNew = it => it.noticeDate && dday(it.noticeDate) >= -7;
const sgn = m => (m >= 0 ? '+' : '') + won(m);
const mtone = m => (m == null ? 'plain' : m >= 2e8 ? 'good' : m >= 1e8 ? 'mid' : 'bad');
/** 59㎡·84㎡ 칸: 분양가(최고가)와 안전마진 */
function sizeBox(it, t) {
  const z = sizeInfo(it, t);
  if (!z) return `<span class="st plain none"><small>${t}㎡</small><b class="mono">없음</b></span>`;
  const unsure = z.reliable === false && z.margin != null;
  const price = z.lo === z.hi ? won(z.hi) : `${won(z.lo)}~${won(z.hi).replace('억', '')}억`;
  return `<span class="st ${unsure ? 'mid' : mtone(z.margin)}"><small>${t}㎡ <span class="mono">${price.replace('~', '~')}</span></small><b class="mono">${z.margin != null ? sgn(z.margin) + (unsure ? '?' : '') : '시세 ?'}</b></span>`;
}
const tone = v => ({ 추천: 'good', 가능: 'good', 조건부: 'mid', 애매: 'mid', 비추천: 'bad', 불가: 'bad' }[v] || 'mid');
function card(it) {
  const m = it.invest.margin, c = it.commute?.avg, unsure = it.invest.marginReliable === false;
  return `<a class="card" href="#item=${encodeURIComponent(it.id)}">
    <div class="row"><span class="rk mono${it.rank <= 3 ? ' top' : ''}">${it.rank}</span><span class="nm">${isNew(it) ? '<span class="newb">NEW</span> ' : ''}${it.hot ? `<span class="fire">${'🔥'.repeat(it.hot)}</span> ` : ''}${it.place ? `<span class="place">(${esc(it.place)})</span> ` : ''}${esc(it.shortName || it.name)}</span>${it.fit ? `<span class="fit mono" title="나에게 맞는 정도">${it.fit.total}<small>점</small></span>` : ''}</div>
    ${it.overall.star || it.eligTag || it.overBudget ? `<div class="tags">${it.overall.star ? '<span class="pill v-star">⭐ 강력 추천</span>' : ''}${etag(it)}${it.overBudget ? '<span class="etag warn">💸 예산 초과</span>' : ''}</div>` : ''}
    <div class="stats">${sizeBox(it, 59)}${sizeBox(it, 84)}<span class="st ${tone(it.commuteResult.verdict)}"><small>🚗 출퇴근</small><b class="mono">${c ? c + '분' : '-'}</b></span></div>
    ${it.hotWhy ? `<div class="hotwhy">🔥 ${esc(it.hotWhy)}</div>` : unsure ? '<div class="hotwhy muted">주변 시세가 이상하게 나와 마진은 참고만 하세요</div>' : ''}
    <div class="meta"><span class="tag">${esc(it.categoryLabel)}</span>${dueTag(it)}<span>${esc(nextStep(it))}</span></div>
  </a>`;
}

function hotCard(it) {
  const b = it.buzz || {};
  const plus = k => (b[k + 'Capped'] ? '+' : '');
  return `<a class="hot" href="#item=${encodeURIComponent(it.id)}"><span class="nm">${'🔥'.repeat(it.hot)} ${it.place ? `<span class="place">(${esc(it.place)})</span> ` : ''}${esc(it.shortName || it.name)}${etag(it)}</span>
    <span class="why">${esc(it.hotWhy || '')}</span>
    <span class="sub">${[sizeInfo(it, 59) && `59㎡ ${won(sizeInfo(it, 59).hi)}`, sizeInfo(it, 84) && `84㎡ ${won(sizeInfo(it, 84).hi)}`, it.competition?.maxRate && `경쟁률 최고 ${it.competition.maxRate}:1`].filter(Boolean).join(' · ')}</span>
    <span class="pills">${vpill('투자', it.invest.verdict)}${vpill('자격', it.eligibility.status)}</span></a>`;
}

// ── 분석 페이지 ──
/** 강점·약점 한 줄씩: 판정을 한눈에 */
function prosCons(it) {
  const pro = [], con = [];
  const m = it.invest.margin, c = it.commute?.avg, st = it.location?.subway?.[0];
  if (m != null && it.invest.marginReliable !== false) (m >= 2e8 ? pro : m < 1e8 ? con : pro).push(`안전마진 ${sgn(m)}`);
  else con.push('주변 시세 불확실');
  if (c) (c <= 30 ? pro : c > 45 ? con : pro).push(`출퇴근 ${c}분`);
  if (st) (st.m <= 800 ? pro : st.m > 1500 ? con : pro).push(`${st.name} ${st.m.toLocaleString()}m`); else if (it.geo) con.push('역 2km 밖');
  if (it.eligibility.status === '불가') con.push(`자격 미달(${it.eligTag?.why || ''})`);
  else if (it.eligTag) con.push(it.eligTag.text + (it.eligTag.why ? `(${it.eligTag.why})` : ''));
  const br = brandOf(it); if (br) pro.push(br);
  if (it.invest.repeated) con.push(`${it.invest.repeated}차 반복 공급`);
  if (it.buzzLevel) pro.push('SNS 언급 많음');
  if (it.competition?.maxRate >= 10) pro.push(`경쟁률 최고 ${it.competition.maxRate}:1`);
  return { pro, con };
}
function detailView(id) {
  const it = R.items.find(i => i.id === id);
  if (!it) { location.hash = ''; return; }
  const loc = it.location || {}, el = it.eligibility, inv = it.invest, com = it.commuteResult;
  const map = it.geo ? `https://map.kakao.com/link/map/${encodeURIComponent(it.name)},${it.geo.y},${it.geo.x}` : null;
  const nav = it.geo ? `https://map.kakao.com/link/to/${encodeURIComponent(it.name)},${it.geo.y},${it.geo.x}` : null;
  const models = (it.models || []).filter(m => m.topPrice);
  const reasonRows = arr => (arr || []).map(n => `<div class="${esc(n.s)}"><b>${esc(n.k)}</b><span>${esc(n.v)}</span></div>`).join('');
  const marketRows = (it.market || []).map(m => `<tr><td>전용 ${m.area}㎡ (${m.pyeong ?? '-'}평)</td><td class="mono">${won(m.price)}</td><td class="mono">${m.comp.estimate ? won(m.comp.estimate) : '-'}</td><td class="mono">${m.margin != null ? sgn(m.margin) + (m.reliable === false ? '?' : '') : esc(m.comp.reason || m.comp.status)}</td></tr>`).join('');
  const comps = (it.market || []).find(m => m.comp.complexes)?.comp.complexes || [];
  const best = (it.market || []).filter(r => r.margin != null).sort((a, b) => Math.abs(a.area - 84) - Math.abs(b.area - 84))[0];
  const pc = prosCons(it);
  const kpi = (label, val, cls = '', sub = '') => `<div class="kpi ${cls}"><small>${label}</small><b class="mono">${val}</b>${sub ? `<span>${sub}</span>` : ''}</div>`;
  app.innerHTML = `<div class="wrap">
    <a class="btn back" href="#">← 목록</a>
    <div><h1>${it.place ? `<span class="place">(${esc(it.place)})</span> ` : ''}${esc(it.shortName || it.name)}</h1><p class="sub">${esc(it.categoryLabel)} · ${esc(it.address || it.region)}</p></div>
    <div class="tags">${it.overall.star ? '<span class="pill v-star">⭐ 강력 추천</span>' : ''}${it.hot ? `<span class="pill v-star">${'🔥'.repeat(it.hot)} 핫</span>` : ''}${dueTag(it)}${etag(it)}<span class="tag">${esc(nextStep(it))}</span></div>
    <div class="sizes">${[59, 84].map(t => { const z = sizeInfo(it, t); if (!z) return `<div class="size none"><b>${t}㎡</b><span class="sub">이 공고엔 없어요</span></div>`;
      const unsure = z.reliable === false && z.margin != null;
      return `<div class="size ${unsure ? 'mid' : mtone(z.margin)}"><div class="h"><b>${t}㎡</b><small>전용 ${z.area}㎡</small></div>
        <dl><div><dt>분양가</dt><dd class="mono">${z.lo === z.hi ? won(z.hi) : `${won(z.lo)}~${won(z.hi)}`}</dd></div><div><dt>주변 시세</dt><dd class="mono">${z.estimate ? won(z.estimate) : '-'}</dd></div><div class="m"><dt>안전마진</dt><dd class="mono">${z.margin != null ? sgn(z.margin) + (unsure ? '?' : '') : '시세 부족'}</dd></div></dl>${z.method ? `<small class="sub">${esc(z.method)}${unsure ? ' · 편차 커서 참고만' : ''}</small>` : ''}</div>`; }).join('')}</div>
    ${it.hotWhy ? `<div class="hotwhy">🔥 ${esc(it.hotWhy)}</div>` : ''}
    <div class="kpis two">
      ${kpi('출퇴근', it.commute?.avg ? `${it.commute.avg}분` : '-', tone(com.verdict), R.wp ? esc(R.wp.name) : '직장 미설정')}
      ${kpi('자격', esc(el.status), tone(el.status === '경계' ? '애매' : el.status), it.eligTag ? esc(it.eligTag.why || it.eligTag.text) : '')}
    </div>
    <section class="panel pc"><div><h2>👍 강점</h2><ul>${pc.pro.map(x => `<li>${esc(x)}</li>`).join('') || '<li class="sub">없음</li>'}</ul></div><div><h2>👎 약점</h2><ul>${pc.con.map(x => `<li>${esc(x)}</li>`).join('') || '<li class="sub">없음</li>'}</ul></div></section>
    <div class="actions">
      ${it.noticeUrl ? `<a class="btn primary" href="${esc(it.noticeUrl)}" target="_blank" rel="noopener">공고문 원문 보기 ↗</a>` : ''}
      <div class="mini">${it.lhUrl ? `<a class="btn" href="${esc(it.lhUrl)}" target="_blank" rel="noopener">LH 공고 ↗</a>` : ''}${map ? `<a class="btn" href="${map}" target="_blank" rel="noopener">지도 ↗</a>` : ''}${nav ? `<a class="btn" href="${nav}" target="_blank" rel="noopener">길찾기 ↗</a>` : ''}</div>
    </div>

    <section class="panel"><h2>왜 이 판정인가요?</h2><div class="verdict">
      <div class="vrow">${vpill('투자', inv.verdict)}<span>${inv.margin != null ? `안전마진 ${sgn(inv.margin)}` : '안전마진 불확실'} · 기준: 2억 이상 추천, 1~2억 조건부, 1억 미만 비추천 (입지 가점 ${inv.plus} / 감점 ${inv.minus} 반영)</span></div>
      <div class="vrow">${vpill('자격', el.status)}<span>${esc(el.checks.filter(c => c.s !== 'good').map(c => c.k).join(', ') || '확인된 기준 모두 통과')}${el.checks.some(c => c.s === 'bad') ? ' 기준에 걸려요' : el.checks.some(c => c.s === 'mid') ? ' 확인이 필요해요' : ''}</span></div>
      <div class="vrow">${vpill('출퇴근', com.verdict)}<span>${esc(com.text)} · 30분 이내 가능, 45분 이내 애매</span></div>
      <div class="vrow"><span class="pill ${it.overall.star ? 'v-star' : 'v-' + esc(inv.verdict)}">⭐ 조건</span><span>${it.overall.star ? '자격 가능 + 투자 추천 + 출퇴근 가능을 모두 만족해요' : '자격 가능 + 투자 추천 + 출퇴근 30분 이내 중 ' + [el.status !== '가능' && '자격', inv.verdict !== '추천' && '투자', com.verdict !== '가능' && '출퇴근'].filter(Boolean).join('·') + ' 미충족'}</span></div>
    </div></section>

    ${it.fit ? `<section class="panel"><h2>나에게 맞는 정도 <span class="mono">${it.fit.total}점</span> <span class="sub">/ 100</span></h2><div class="bars">${it.fit.parts.filter(p => p.max > 0).map(p => `<div><b>${esc(p.k)}</b><span class="bar"><i style="width:${Math.round(p.v / p.max * 100)}%"></i></span><span class="mono">${p.v}/${p.max}</span><span class="sub">${esc(p.why)}</span></div>`).join('')}</div></section>` : ''}

    <section class="panel"><h2>주변 시세 · 안전마진</h2>
      ${marketRows ? `<div class="tbl"><table><thead><tr><th>평형</th><th>분양가</th><th>주변 시세</th><th>마진(취득세·확장비 차감)</th></tr></thead><tbody>${marketRows}</tbody></table></div>` : '<p class="sub">비교할 주택형 정보가 없어요. 공고문에서 확인해 주세요.</p>'}
      ${comps.length ? `<details><summary>비교 단지 ${comps.length}곳 보기</summary><div class="tbl"><table><thead><tr><th>단지</th><th>거리</th><th>준공</th><th>거래</th><th>중위가</th></tr></thead><tbody>${comps.map(c => `<tr><td>${esc(c.name)}${c.self ? ' <span class="tag">같은 단지</span>' : ''}${c.kind === '분양권' ? ' <span class="tag">분양권</span>' : ''}</td><td class="mono">${(c.m / 1000).toFixed(1)}km</td><td class="mono">${c.built ?? '-'}</td><td class="mono">${c.n}건</td><td class="mono">${won(c.median)}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
      <p class="sub" style="margin-top:6px">국토부 실거래가·분양권(직거래·해제·입주권 제외), 최근 6개월, 전용 ±8㎡. 같은 단지 거래가 3건 이상이면 그걸 쓰고, 없으면 3km 안 가까운 단지(1km 안 3곳 이상이면 최대 5곳, 아니면 가장 가까운 3곳)의 ㎡당 중위가 중위값. 매매는 준공 10년(신도시 5년) 이내만. 단지끼리 1.7배 넘게 차이 나면 '?'로 표시해요. 새 아파트 프리미엄은 빠져 있어 마진이 보수적으로 나와요.</p>
    </section>

    <section class="panel"><h2>투자 판정 근거</h2><div class="reasons">${reasonRows(inv.notes)}</div></section>
    <section class="panel"><h2>우리 집 자격</h2><div class="reasons">${reasonRows(el.checks)}</div></section>
    <section class="panel"><h2>입지</h2><div class="reasons">
      ${(loc.subway || []).map(s => `<div class="${s.m <= 800 ? 'good' : s.m <= 1500 ? 'mid' : 'bad'}"><b>지하철</b><span>${esc(s.name)} ${s.m.toLocaleString()}m</span></div>`).join('') || '<div class="bad"><b>지하철</b><span>반경 2km 안에 없음</span></div>'}
      ${(loc.elementary || []).map(s => `<div class="${s.m <= 400 ? 'good' : 'mid'}"><b>초등학교</b><span>${esc(s.name)} ${s.m.toLocaleString()}m</span></div>`).join('')}
      ${(loc.middle || []).map(s => `<div class="mid"><b>중학교</b><span>${esc(s.name)} ${s.m.toLocaleString()}m</span></div>`).join('')}
      ${loc.academies1km != null ? `<div class="${loc.academies1km >= 15 ? 'good' : 'mid'}"><b>학원</b><span>1km 안 ${loc.academies1km}곳</span></div>` : ''}
      <div class="mid"><b>출퇴근</b><span>${esc(com.text)}</span></div>
    </div></section>

    <section class="panel"><h2>기본 정보</h2><dl class="facts">
      <div><dt>공급 유형</dt><dd>${esc(it.categoryLabel)}${it.detailType ? ` (${esc(it.detailType)})` : ''}</dd></div>
      <div><dt>이번 공급</dt><dd class="mono">${it.totalUnits ? it.totalUnits.toLocaleString() + '세대' : '-'}</dd></div>
      <div><dt>접수 일정</dt><dd>${esc(schedule(it)) || '-'}</dd></div>
      <div><dt>당첨 발표</dt><dd>${esc(md(it.schedule?.winners)) || '-'}</dd></div>
      <div><dt>입주 예정</dt><dd>${it.moveIn ? esc(it.moveIn.slice(0, 4) + '년 ' + +it.moveIn.slice(4) + '월') : '-'}</dd></div>
      <div><dt>시공</dt><dd>${esc(it.builder || '-')}</dd></div>
      <div><dt>규제</dt><dd>${[it.flags?.speculativeZone && '투기과열', it.flags?.adjustArea && '조정대상', it.flags?.priceCap && '분양가상한제', it.flags?.publicLand && '공공택지'].filter(Boolean).join(' · ') || '-'}</dd></div>
      <div><dt>문의</dt><dd class="mono">${esc(it.phone || '-')}</dd></div>
    </dl></section>

    ${models.length ? `<section class="panel"><h2>주택형 · 분양가</h2><div class="tbl"><table><thead><tr><th>주택형</th><th>평형</th><th>최고 분양가</th><th>일반</th><th>특공</th></tr></thead><tbody>
      ${models.map(m => `<tr><td class="mono">${esc(m.type)}</td><td class="mono">${m.pyeong ?? '-'}평</td><td class="mono">${won(m.topPrice)}</td><td class="mono">${m.general ?? '-'}</td><td class="mono">${m.special ?? '-'}</td></tr>`).join('')}
    </tbody></table></div><p class="sub" style="margin-top:6px">평형은 공급면적 ÷ 3.3058. 발코니 확장·필수 옵션은 별도예요.</p></section>` : ''}

    ${it.buzz ? `<section class="panel"><h2>SNS 언급</h2>${it.buzz.reason ? `<p><b>${esc(it.buzz.reason)}</b></p>` : ''}<p>최근 ${it.buzz.days}일 다음 검색 "${esc(it.buzz.query)}": 블로그 <b class="mono">${it.buzz.blog}${it.buzz.blogCapped ? '+' : ''}</b> · 카페 <b class="mono">${it.buzz.cafe}</b> · 영상 <b class="mono">${it.buzz.vclip}</b> · 웹문서 <b class="mono">${it.buzz.web}${it.buzz.webCapped ? '+' : ''}</b>${it.competition?.maxRate ? ` · 청약 경쟁률 최고 <b class="mono">${it.competition.maxRate}:1</b>` : ''}</p><p class="sub" style="margin-top:6px">블로그에는 분양 홍보 글이 섞여 있어서 화제성이 곧 좋은 단지라는 뜻은 아니에요. 스레드·인스타그램은 공개 검색이 안 돼서 포함하지 못했어요.</p></section>` : ''}
    ${it.analysisNote ? `<div class="banner info">${esc(it.analysisNote)}</div>` : ''}
    ${it.analysisError ? `<div class="banner warn">일부 분석 실패: ${esc(it.analysisError)}</div>` : ''}
    <p class="sub">투자 자문이 아닌 참고 자료예요. 자격·금액·실거주·전매 조건은 반드시 공고문 원문으로 확인하세요.</p>
  </div>`;
  window.scrollTo(0, 0);
}

// ── 서버(구글 시트)와 동기화: 직장·알림·점수 비율만 ──
let CONFIG = {};
const uid = () => { let u = store.get('cy-uid'); if (!u) { u = (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)).toLowerCase(); store.set('cy-uid', u); } return u; };
async function share(body) {
  if (!CONFIG.sheetUrl) return;
  // 구글 Apps Script는 CORS 응답을 주지 않아서 no-cors로 보낸다 (응답은 못 읽지만 저장은 된다)
  try { await fetch(CONFIG.sheetUrl, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ uid: uid(), ...body }) }); } catch {}
}
// 우리 집 정보(소득·자산·생년월일 등)는 보내지 않는다. 서버가 쓰는 것만: 직장(출퇴근 계산), 알림 구독, 점수 비율·지역(아침 알림 순위)
async function syncShare(hh) {
  const push = (() => { try { return JSON.parse(store.get('cy-push') || 'null'); } catch { return null; } })();
  const p = hh?.prefs || {};
  const needed = p.workplaceAddress || push;
  if (hh?.shareConsent && needed) {
    await share({ settings: { shareConsent: true, prefs: { workplace: p.workplace || null, workplaceId: p.workplaceId || null, workplaceAddress: p.workplaceAddress || null, regions: p.regions, weights: p.weights } }, push });
    store.set('cy-shared', '1');
  }
  else if (store.get('cy-shared')) { await share({ delete: true }); store.del('cy-shared'); }
}
const pushHelper = () => ({
  standalone: window.matchMedia('(display-mode: standalone)').matches || navigator.standalone,
  subscribed: !!store.get('cy-push'),
  async subscribe() {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('알림이 허용되지 않았어요. 설정 앱 → 알림 → 청약레이더에서 켜 주세요.');
    const reg = await navigator.serviceWorker.ready;
    const key = Uint8Array.from(atob(VAPID_PUBLIC.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - VAPID_PUBLIC.length % 4) % 4)), c => c.charCodeAt(0));
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
    store.set('cy-push', JSON.stringify(sub.toJSON()));
    const hh = loadHH(); if (hh?.shareConsent) await syncShare(hh);
    return sub.toJSON();
  },
});
function settingsView() {
  householdView({ app, esc, workplaces: RAW.workplaces || [], current: loadHH(), push: pushHelper(), canShare: !!CONFIG.sheetUrl,
    onForget: () => { store.del('cy-pass'); R = RAW = null; location.hash = ''; lockView(); },
    onSave: async hh => {
      if (hh) store.set('cy-household', JSON.stringify(hh)); else store.del('cy-household');
      syncShare(hh);
      R = enrich(RAW); location.hash = ''; route();
    } });
}

function route() {
  if (!R) return;
  const h = location.hash.slice(1);
  if (h.startsWith('item=')) detailView(decodeURIComponent(h.slice(5)));
  else if (h === 'settings' || h === 'household') settingsView();
  else listView();
}
window.addEventListener('hashchange', route);
boot();
