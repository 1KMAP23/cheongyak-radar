// 청약 레이더 웹앱: 잠금 해제 → 목록 → 단지별 분석 페이지 → 공고문 원문 링크
const VAPID_PUBLIC = 'BDGbFHT5-WKQMTzp1Y_tj_5ByKKSqmjqoVrW-P67Yf2_EUMiaAS6Xabst53usz-kz1tCr6UA8OA_vk-gl47xPCA';
const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: k => { try { localStorage.removeItem(k); } catch {} } };
const won = n => n == null ? '-' : Math.abs(n) >= 1e8 ? `${(n / 1e8).toFixed(2).replace(/\.?0+$/, '')}억` : `${Math.round(n / 1e4).toLocaleString()}만`;
const md = s => s ? s.slice(5).replace('-', '/') : '';
let R = null, filter = store.get('cy-filter') || 'all';

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
    try { R = await decrypt(p); store.set('cy-pass', p); route(); }
    catch (e) { document.getElementById('err').textContent = e.message === 'nodata' ? '아직 오늘 데이터가 없어요. 잠시 후 다시 열어 주세요.' : '비밀번호가 맞지 않아요.'; }
  });
}

async function boot() {
  const p = store.get('cy-pass');
  if (!p) return lockView();
  try { R = await decrypt(p); route(); }
  catch (e) { if (e.message === 'nodata') app.innerHTML = '<div class="wrap"><p class="sub">오늘 데이터가 아직 없어요. 잠시 후 다시 열어 주세요.</p></div>'; else { store.del('cy-pass'); lockView('비밀번호가 바뀌었어요. 다시 넣어 주세요.'); } }
}

// ── 공통 조각 ──
const vpill = (label, v) => `<span class="pill v-${esc(String(v).replace(/\s/g, ''))}">${esc(label)} ${esc(v)}</span>`;
function due(it) {
  const t = R.range.from, e = it.window?.end;
  if (!e) return '';
  if (e === t) return '<span class="due">오늘 마감</span>';
  const d = Math.round((Date.parse(e) - Date.parse(t)) / 864e5);
  return `<span class="tag">D-${d}</span>`;
}
function schedule(it) {
  const s = it.schedule || {}, out = [];
  const f = (l, a) => a && a[0] && out.push(`${l} ${md(a[0])}${a[1] && a[1] !== a[0] ? '~' + md(a[1]) : ''}`);
  f('특공', s.special); f('1순위', s.rank1); f('2순위', s.rank2); f('접수', s.single);
  if (!out.length && it.window) out.push(`${md(it.window.start)}~${md(it.window.end)}`);
  return out.join(' · ');
}
const priceRange = it => { const p = (it.models || []).map(m => m.topPrice).filter(Boolean); if (!p.length) return ''; const a = Math.min(...p), b = Math.max(...p); return a === b ? won(a) : `${won(a)}~${won(b)}`; };
const areaRange = it => [...new Set((it.models || []).map(m => Math.round(m.exclusiveArea)).filter(Boolean))].sort((a, b) => a - b).map(a => a + '㎡').join('·');

// ── 목록 ──
function match(it) {
  if (filter === 'star') return it.overall.star;
  if (filter === 'rec') return it.invest.verdict === '추천';
  if (filter === 'near') return it.commuteResult.verdict === '가능' || it.commuteResult.verdict === '애매';
  if (filter === 'ok') return it.eligibility.status !== '불가';
  return true;
}
function listView() {
  const s = R.summary;
  const items = R.items.filter(match);
  const warn = R.warnings.length ? `<div class="banner warn">⚠️ ${R.warnings.map(esc).join('<br>')}</div>` : '';
  const only = R.crossCheck?.onlyLH?.length ? `<div class="banner info">청약홈에 없고 LH에만 올라온 공고 ${R.crossCheck.onlyLH.length}건도 포함했어요.</div>` : '';
  const noHh = R.hasHousehold ? '' : '<div class="banner info">세대 정보가 아직 없어서 자격은 \'확인 필요\'로 표시돼요.</div>';
  app.innerHTML = `<div class="wrap">
    <div class="top"><div><h1>청약 레이더</h1><p class="sub">${md(R.range.from)}~${md(R.range.to)} 접수 · ${new Date(R.generatedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 분석</p></div>
      <a class="btn" href="#settings" aria-label="설정">⚙︎</a></div>
    ${warn}${noHh}
    <div class="chips"><span class="chip">전체 <b class="mono">${s.total}</b></span><span class="chip">⭐ <b class="mono">${s.star}</b></span><span class="chip">추천 <b class="mono">${s.recommend}</b></span><span class="chip">조건부 <b class="mono">${s.conditional}</b></span><span class="chip">비추천 <b class="mono">${s.notRecommend}</b></span></div>
    <div class="chips" role="group" aria-label="필터">
      ${[['all', '전체'], ['star', '⭐ 강력 추천'], ['rec', '투자 추천'], ['near', '출퇴근 45분 이내'], ['ok', '자격 되는 것']].map(([k, l]) => `<button class="chip" data-f="${k}" aria-pressed="${filter === k}">${l}</button>`).join('')}
    </div>
    ${only}
    <div class="list">${items.length ? items.map(card).join('') : '<p class="sub">조건에 맞는 공고가 없어요.</p>'}</div>
    <p class="sub">투자 자문이 아닌 참고 자료예요. 자격·금액은 반드시 공고문 원문으로 확인하세요.</p>
  </div>`;
  app.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', () => { filter = b.dataset.f; store.set('cy-filter', filter); listView(); }));
}
function card(it) {
  const off = it.eligibility.status === '불가';
  return `<a class="card${off ? ' off' : ''}" href="#item=${encodeURIComponent(it.id)}">
    <div class="row"><span class="nm">${esc(it.name)}</span>${due(it)}</div>
    <div class="pills">${it.overall.star ? '<span class="pill v-star">⭐ 강력 추천</span>' : ''}${vpill('자격', it.eligibility.status)}${vpill('투자', it.invest.verdict)}${vpill('출퇴근', it.commuteResult.verdict)}</div>
    <div class="meta"><span>${esc(it.region)}</span><span class="tag">${esc(it.categoryLabel)}</span>${it.onlyLH ? '<span class="tag">LH 단독</span>' : ''}<span>${esc(schedule(it))}</span></div>
    <div class="meta mono">${esc([areaRange(it), priceRange(it), it.invest.margin != null ? `안전마진 ${it.invest.margin >= 0 ? '+' : ''}${won(it.invest.margin)}` : '', it.commute?.avg ? `출퇴근 ${it.commute.avg}분` : ''].filter(Boolean).join(' · '))}</div>
  </a>`;
}

// ── 분석 페이지 ──
function detailView(id) {
  const it = R.items.find(i => i.id === id);
  if (!it) { location.hash = ''; return; }
  const loc = it.location || {}, el = it.eligibility, inv = it.invest, com = it.commuteResult;
  const map = it.geo ? `https://map.kakao.com/link/map/${encodeURIComponent(it.name)},${it.geo.y},${it.geo.x}` : null;
  const nav = it.geo ? `https://map.kakao.com/link/to/${encodeURIComponent(it.name)},${it.geo.y},${it.geo.x}` : null;
  const models = (it.models || []).filter(m => m.topPrice);
  const reasonRows = arr => (arr || []).map(n => `<div class="${esc(n.s)}"><b>${esc(n.k)}</b><span>${esc(n.v)}</span></div>`).join('');
  const marketRows = (it.market || []).map(m => `<tr><td>전용 ${m.area}㎡ (${m.pyeong ?? '-'}평)</td><td class="mono">${won(m.price)}</td><td class="mono">${m.comp.estimate ? won(m.comp.estimate) : '-'}</td><td class="mono">${m.margin != null ? (m.margin >= 0 ? '+' : '') + won(m.margin) : esc(m.comp.reason || m.comp.status)}</td></tr>`).join('');
  const comps = (it.market || []).find(m => m.comp.complexes)?.comp.complexes || [];
  app.innerHTML = `<div class="wrap">
    <a class="btn back" href="#">← 목록</a>
    <div><h1>${esc(it.name)}</h1><p class="sub">${esc(it.address || it.region)}</p></div>
    <div class="pills">${it.overall.star ? '<span class="pill v-star">⭐ 강력 추천</span>' : ''}${vpill('자격', el.status)}${vpill('투자', inv.verdict)}${vpill('출퇴근', com.verdict)}</div>
    <div class="actions">
      ${it.noticeUrl ? `<a class="btn primary" href="${esc(it.noticeUrl)}" target="_blank" rel="noopener">공고문 원문 보기 ↗</a>` : ''}
      ${it.lhUrl ? `<a class="btn" href="${esc(it.lhUrl)}" target="_blank" rel="noopener">LH 공고 ↗</a>` : ''}
      ${map ? `<a class="btn" href="${map}" target="_blank" rel="noopener">지도 ↗</a>` : ''}
      ${nav ? `<a class="btn" href="${nav}" target="_blank" rel="noopener">길찾기 ↗</a>` : ''}
    </div>

    <section class="panel"><h2>왜 이 판정인가요?</h2><div class="verdict">
      <div class="vrow">${vpill('자격', el.status)}<span>${esc(el.checks.filter(c => c.s !== 'good').map(c => c.k).join(', ') || '확인된 기준 모두 통과')}${el.checks.some(c => c.s === 'bad') ? ' 기준에 걸려요' : el.checks.some(c => c.s === 'mid') ? ' 확인이 필요해요' : ''}</span></div>
      <div class="vrow">${vpill('투자', inv.verdict)}<span>${inv.margin != null ? `안전마진 ${inv.margin >= 0 ? '+' : ''}${won(inv.margin)}` : '안전마진 불확실'} · 가점 ${inv.plus} / 감점 ${inv.minus}. 기준: 2억 이상 추천, 1~2억 조건부, 1억 미만 비추천</span></div>
      <div class="vrow">${vpill('출퇴근', com.verdict)}<span>${esc(com.text)} · 30분 이내 가능, 45분 이내 애매</span></div>
      <div class="vrow"><span class="pill ${it.overall.star ? 'v-star' : 'v-' + esc(inv.verdict)}">종합</span><span>${it.overall.star ? '자격 가능 + 투자 추천 + 출퇴근 가능을 모두 만족해요' : '⭐ 조건(자격 가능 + 투자 추천 + 출퇴근 30분 이내) 중 ' + [el.status !== '가능' && '자격', inv.verdict !== '추천' && '투자', com.verdict !== '가능' && '출퇴근'].filter(Boolean).join('·') + ' 미충족'}</span></div>
    </div></section>

    <section class="panel"><h2>기본 정보</h2><dl class="facts">
      <div><dt>공급 유형</dt><dd>${esc(it.categoryLabel)}${it.detailType ? ` (${esc(it.detailType)})` : ''}</dd></div>
      <div><dt>총 세대수</dt><dd class="mono">${it.totalUnits ? it.totalUnits.toLocaleString() + '세대' : '-'}</dd></div>
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

    <section class="panel"><h2>주변 시세 · 안전마진</h2>
      ${marketRows ? `<div class="tbl"><table><thead><tr><th>평형</th><th>분양가</th><th>주변 시세</th><th>마진(취득세 차감)</th></tr></thead><tbody>${marketRows}</tbody></table></div>` : '<p class="sub">비교할 주택형 정보가 없어요. 공고문에서 확인해 주세요.</p>'}
      ${comps.length ? `<h2 style="margin-top:12px">비교 단지</h2><div class="tbl"><table><thead><tr><th>단지</th><th>거리</th><th>준공</th><th>거래</th><th>중위가</th></tr></thead><tbody>${comps.map(c => `<tr><td>${esc(c.name)}${c.kind === '분양권' ? ' <span class="tag">분양권</span>' : ''}</td><td class="mono">${(c.m / 1000).toFixed(1)}km</td><td class="mono">${c.built ?? '-'}</td><td class="mono">${c.n}건</td><td class="mono">${won(c.median)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <p class="sub" style="margin-top:6px">국토부 실거래가·분양권 기준: 반경 1km(부족하면 2·3km), 준공 10년 이내(신도시 블록은 5년 이내·분양권), 전용 ±10㎡, 최근 6개월. 단지별 ㎡당 중위가의 중위값.</p>
    </section>

    <section class="panel"><h2>투자 판정 근거</h2><div class="reasons">${reasonRows(inv.notes)}</div></section>
    <section class="panel"><h2>우리집 자격</h2><div class="reasons">${reasonRows(el.checks)}</div></section>
    <section class="panel"><h2>입지</h2><div class="reasons">
      ${(loc.subway || []).map(s => `<div class="${s.m <= 800 ? 'good' : s.m <= 1500 ? 'mid' : 'bad'}"><b>지하철</b><span>${esc(s.name)} ${s.m.toLocaleString()}m</span></div>`).join('') || '<div class="bad"><b>지하철</b><span>반경 2km 안에 없음</span></div>'}
      ${(loc.elementary || []).map(s => `<div class="${s.m <= 400 ? 'good' : 'mid'}"><b>초등학교</b><span>${esc(s.name)} ${s.m.toLocaleString()}m</span></div>`).join('')}
      ${(loc.middle || []).map(s => `<div class="mid"><b>중학교</b><span>${esc(s.name)} ${s.m.toLocaleString()}m</span></div>`).join('')}
      <div class="mid"><b>출퇴근</b><span>${esc(com.text)}</span></div>
    </div></section>
    ${it.analysisNote ? `<div class="banner info">${esc(it.analysisNote)}</div>` : ''}
    ${it.analysisError ? `<div class="banner warn">일부 분석 실패: ${esc(it.analysisError)}</div>` : ''}
    <p class="sub">투자 자문이 아닌 참고 자료예요. 자격·금액·실거주·전매 조건은 반드시 공고문 원문으로 확인하세요.</p>
  </div>`;
  window.scrollTo(0, 0);
}

// ── 설정: 알림 켜기 ──
function settingsView() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  app.innerHTML = `<div class="wrap">
    <a class="btn back" href="#">← 목록</a><h1>설정</h1>
    <section class="panel"><h2>매일 아침 알림</h2>
      ${standalone ? `<p class="sub">아래 버튼을 누르고 알림을 허용한 뒤, 나오는 코드를 복사해서 Claude에게 보내거나 GitHub 비밀값 <b>PUSH_SUBSCRIPTIONS</b>에 넣어 주세요.</p>
        <p style="margin-top:10px"><button class="primary" id="sub">알림 켜기</button></p><div class="err" id="perr"></div>
        <div id="out" hidden><textarea id="code" readonly></textarea><p style="margin-top:8px"><button id="copy">코드 복사</button></p></div>`
      : `<p class="sub">아이폰 알림은 홈 화면에 추가한 앱에서만 켤 수 있어요. Safari 아래쪽 공유 버튼 → <b>홈 화면에 추가</b> → 홈 화면의 청약레이더 아이콘으로 다시 열어 주세요.</p>`}
    </section>
    <section class="panel"><h2>이 기기</h2><p class="sub">저장된 비밀번호를 지우면 다음에 다시 물어봐요.</p><p style="margin-top:10px"><button id="forget">비밀번호 지우기</button></p></section>
  </div>`;
  document.getElementById('forget').onclick = () => { store.del('cy-pass'); R = null; location.hash = ''; lockView(); };
  const btn = document.getElementById('sub');
  if (btn) btn.onclick = async () => {
    const err = document.getElementById('perr');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { err.textContent = '알림이 허용되지 않았어요. 설정 앱 → 알림 → 청약레이더에서 켜 주세요.'; return; }
      const reg = await navigator.serviceWorker.ready;
      const key = Uint8Array.from(atob(VAPID_PUBLIC.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - VAPID_PUBLIC.length % 4) % 4)), c => c.charCodeAt(0));
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
      document.getElementById('code').value = JSON.stringify([sub.toJSON()]);
      document.getElementById('out').hidden = false; err.textContent = '';
    } catch (e) { err.textContent = '알림 설정 실패: ' + e.message; }
  };
  const copy = document.getElementById('copy');
  if (copy) copy.onclick = async () => { const t = document.getElementById('code'); try { await navigator.clipboard.writeText(t.value); copy.textContent = '복사됨'; } catch { t.select(); } };
}

function route() {
  if (!R) return;
  const h = location.hash.slice(1);
  if (h.startsWith('item=')) detailView(decodeURIComponent(h.slice(5)));
  else if (h === 'settings') settingsView();
  else listView();
}
window.addEventListener('hashchange', route);
boot();
