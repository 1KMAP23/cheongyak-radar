// 우리 집 정보 설정: 공고문과 대조하는 데 필요한 값을 체크박스·입력칸으로 받는다.
// 이 기기에만 저장되고 서버로 보내지 않는다. 다른 기기로 옮길 때는 내보내기/가져오기.
const MAN = 1e4; // 입력은 만원 단위

export function householdView({ app, esc, workplaces, current, onSave }) {
  const h = current || { prefs: { regions: ['서울', '경기', '인천'], workplace: workplaces[0]?.id || '' }, homeless: true };
  const v = (x, d = '') => (x == null ? d : esc(x));
  const m = x => (x == null || x === '' ? '' : Math.round(x / MAN));
  const kids = h.children?.length ? h.children : [];
  const cars = h.assets?.cars?.length ? h.assets.cars : [];
  const yr = new Date().getFullYear();
  const chk = (id, on, label, hint = '') => `<label class="ck"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span>${label}${hint ? `<small>${hint}</small>` : ''}</span></label>`;
  const fld = (id, label, val, type = 'text', extra = '') => `<label class="fld"><span>${label}</span><input id="${id}" type="${type}" value="${val}" ${extra}></label>`;
  const money = (id, label, val, hint = '') => `<label class="fld"><span>${label}${hint ? `<small>${hint}</small>` : ''}</span><span class="unit"><input id="${id}" type="number" inputmode="numeric" min="0" step="1" value="${m(val)}"><i>만원</i></span></label>`;

  const kidRow = (c = {}, i) => `<div class="row-item" data-kid>
    ${fld(`kid-birth-${i}`, c.expected ? '출산 예정일' : '생년월일', v(c.birth?.length === 7 ? `${c.birth}-01` : c.birth), 'date')}
    ${chk(`kid-exp-${i}`, c.expected, '아직 출산 전 (임신 중)')}
    <button type="button" class="link" data-del>삭제</button></div>`;
  const carRow = (c = {}, i) => `<div class="row-item" data-car>
    ${fld(`car-name-${i}`, '차 이름', v(c.name), 'text', 'placeholder="예: 쏘렌토"')}
    ${fld(`car-reg-${i}`, '등록일(출고 예정일)', v(c.registeredAt), 'date')}
    ${money(`car-v0-${i}`, `${yr}년 시가표준액`, c.values?.[yr] ?? c.baseValue, '신차는 차값÷1.1')}
    ${money(`car-v1-${i}`, `${yr + 1}년 시가표준액`, c.values?.[yr + 1], '1월에 홈택스에서 조회')}
    ${chk(`car-in-${i}`, c.inHousehold !== false, '같은 등본 세대원 명의')}
    <button type="button" class="link" data-del>삭제</button></div>`;

  app.innerHTML = `<div class="wrap hh">
    <a class="btn back" href="#">← 목록</a>
    <div><h1>우리 집 정보</h1><p class="sub">공고문의 자격 기준과 비교하는 데 써요. <b>이 기기에만 저장</b>되고 다른 사람에게 보이지 않아요. 모르는 칸은 비워 두면 그 항목만 '확인 필요'로 나와요.</p></div>

    <section class="panel"><h2>1. 신청자와 세대</h2>
      <p class="sub">청약을 넣을 사람(신청자) 기준으로 적어요. 부부라면 보통 세대주가 신청자예요.</p>
      ${fld('ap-birth', '신청자 생년월일', v(h.applicantInfo?.birth), 'date')}
      ${chk('head', !!h.householdHeadSince, '신청자가 세대주예요')}
      ${fld('head-since', '세대주가 된 날 (등본 기준)', v(h.householdHeadSince), 'date')}
      ${chk('homeless', h.homeless !== false, '세대원 전원 무주택이에요', '분양권·입주권도 주택으로 봐요')}
      ${fld('nohome', '무주택이 된 날 (한 번도 집이 없었으면 비워 두기)', v(h.noHomeSince), 'date')}
      ${chk('never', !!h.neverOwned, '세대원 모두 평생 집을 가진 적이 없어요', '생애최초 특공 조건')}
      ${chk('tax5', (h.incomeTaxYears?.applicant || 0) >= 5, '신청자가 소득세를 5년 이상 냈어요', '생애최초 특공 조건 (기간 합산)')}
      ${chk('win', !!h.recentWin, '세대원이 최근 10년 안에 청약 당첨된 적 있어요', '재당첨 제한 확인')}
    </section>

    <section class="panel"><h2>2. 결혼·자녀·부모님</h2>
      ${chk('married', !!h.marriageDate, '결혼했어요 (혼인신고 완료)')}
      ${fld('marriage', '혼인신고일', v(h.marriageDate), 'date')}
      ${chk('pre', !!h.preMarriage, '예비 신혼부부예요 (입주 전 혼인신고 예정)')}
      ${chk('single', !!h.singleParent, '한부모 가족이에요')}
      <div id="kids">${kids.map(kidRow).join('')}</div>
      <button type="button" class="btn" id="add-kid">+ 자녀 추가</button>
      ${fld('parents', '같은 등본에 3년 이상 함께 산 부모님 수', v(h.parentsDependents, 0), 'number', 'inputmode="numeric" min="0" max="4"')}
      ${chk('p65', !!h.parentsOver65, '그중 만 65세 이상인 분이 있어요', '노부모부양 특공')}
    </section>

    <section class="panel"><h2>3. 사는 곳</h2>
      <label class="fld"><span>신청자 주민등록 주소 (시·도)</span><select id="sido">${['서울', '경기', '인천', '기타'].map(x => `<option ${h.residence?.sido === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      ${fld('since', '그 시·도로 전입한 날', v(h.residence?.since), 'date')}
    </section>

    <section class="panel"><h2>4. 소득 (세전 월평균)</h2>
      ${money('inc-a', '신청자', h.monthlyIncome?.applicant)}
      ${money('inc-p', '배우자', h.monthlyIncome?.partner)}
      <p class="sub">두 사람 다 소득이 있으면 맞벌이로 계산해요.</p>
    </section>

    <section class="panel"><h2>5. 자산</h2>
      ${money('re', '부동산 (토지·건물)', h.assets?.realEstate, '집이 없으면 0')}
      ${money('jeonse', '전세·월세 보증금', h.assets?.jeonseDeposit, '신혼희망타운 총자산에 들어가요')}
      ${fld('jeonse-end', '전세 계약 만기일', v(h.assets?.jeonseEnd), 'date')}
      ${money('fin', '예금·적금·주식·ETF', h.assets?.financial, '계약금·잔금에 바로 쓸 수 있는 돈 (차값 낼 돈은 빼고)')}
      ${money('debt', '대출 (부채)', h.assets?.debt)}
      <h2 style="margin-top:12px">자동차</h2>
      <div id="cars">${cars.map(carRow).join('')}</div>
      <button type="button" class="btn" id="add-car">+ 차 추가</button>
    </section>

    <section class="panel"><h2>6. 신청자 청약통장</h2>
      ${fld('bank', '은행', v(h.accounts?.applicant?.bank), 'text', 'placeholder="예: 국민"')}
      ${fld('opened', '가입일', v(h.accounts?.applicant?.openedAt), 'date')}
      ${fld('paid', '납입 인정 횟수', v(h.accounts?.applicant?.paidCount), 'number', 'inputmode="numeric" min="0"')}
      ${money('amt', '납입 인정 금액', h.accounts?.applicant?.recognizedAmount)}
    </section>

    <section class="panel"><h2>7. 원하는 조건</h2>
      <label class="fld"><span>직장 (출퇴근 계산)</span><select id="wp"><option value="">선택 안 함</option>${workplaces.map(w => `<option value="${esc(w.id)}" ${h.prefs?.workplace === w.id ? 'selected' : ''}>${esc(w.name)} · ${esc(w.address || '')}</option>`).join('')}</select></label>
      <p class="sub">목록에 직장이 없으면 앱 관리자에게 주소를 알려 주세요. 등록되면 매일 아침 그 직장까지 출퇴근 시간이 계산돼요.</p>
      <div class="ck-row">${['서울', '경기', '인천'].map(r => chk(`rg-${r}`, (h.prefs?.regions || ['서울', '경기', '인천']).includes(r), `${r} 공고 보기`)).join('')}</div>
      ${money('maxp', '최대 분양가', h.prefs?.maxPrice, '넘는 단지는 💸 표시')}
    </section>

    <div class="err" id="hh-err"></div>
    <div class="actions"><button class="primary" id="save">저장하고 목록 보기</button><button id="reset">입력값 지우기</button></div>

    <section class="panel"><h2>다른 기기로 옮기기</h2>
      <p class="sub">아래 코드를 복사해서 다른 기기의 같은 칸에 붙여 넣고 가져오기를 누르세요.</p>
      <textarea id="json">${esc(current ? JSON.stringify(current) : '')}</textarea>
      <div class="actions" style="margin-top:8px"><button id="copy">코드 복사</button><button id="import">붙여 넣은 코드 가져오기</button></div>
    </section>
  </div>`;

  const $ = id => document.getElementById(id);
  let kidN = kids.length, carN = cars.length;
  const bindDel = () => app.querySelectorAll('[data-del]').forEach(b => (b.onclick = () => b.closest('.row-item').remove()));
  bindDel();
  $('add-kid').onclick = () => { $('kids').insertAdjacentHTML('beforeend', kidRow({}, kidN++)); bindDel(); };
  $('add-car').onclick = () => { $('cars').insertAdjacentHTML('beforeend', carRow({}, carN++)); bindDel(); };

  const num = id => { const x = $(id)?.value; return x === '' || x == null ? null : +x; };
  const won = id => { const x = num(id); return x == null ? null : x * MAN; };
  const date = id => $(id)?.value || null;

  function collect() {
    const children = [...app.querySelectorAll('[data-kid]')].map(r => {
      const i = r.querySelector('input[type=date]').id.split('-').pop();
      return { birth: date(`kid-birth-${i}`), expected: $(`kid-exp-${i}`).checked };
    }).filter(c => c.birth);
    const carsOut = [...app.querySelectorAll('[data-car]')].map(r => {
      const i = r.querySelector('input').id.split('-').pop();
      const values = {}; const a = won(`car-v0-${i}`), b = won(`car-v1-${i}`);
      if (a != null) values[yr] = a; if (b != null) values[yr + 1] = b;
      return { name: $(`car-name-${i}`).value.trim() || '차량', registeredAt: date(`car-reg-${i}`), values, inHousehold: $(`car-in-${i}`).checked };
    }).filter(c => c.registeredAt || Object.keys(c.values).length);
    const incA = won('inc-a') || 0, incP = won('inc-p') || 0;
    return {
      applicantInfo: { birth: date('ap-birth') },
      householdHeadSince: $('head').checked ? date('head-since') || '2000-01-01' : null,
      homeless: $('homeless').checked,
      noHomeSince: date('nohome'),
      neverOwned: $('never').checked,
      incomeTaxYears: { applicant: $('tax5').checked ? 5 : 0 },
      recentWin: $('win').checked,
      marriageDate: $('married').checked ? date('marriage') : null,
      preMarriage: $('pre').checked,
      singleParent: $('single').checked,
      children,
      parentsDependents: num('parents') || 0,
      parentsOver65: $('p65').checked,
      residence: { sido: $('sido').value, since: date('since') },
      monthlyIncome: { applicant: incA, partner: incP },
      dualIncome: incA > 0 && incP > 0,
      assets: { realEstate: won('re') || 0, jeonseDeposit: won('jeonse') || 0, jeonseEnd: date('jeonse-end'), financial: won('fin') || 0, debt: won('debt') || 0, cars: carsOut },
      accounts: { applicant: { bank: $('bank').value.trim(), openedAt: date('opened'), paidCount: num('paid'), recognizedAmount: won('amt') } },
      prefs: { workplace: $('wp').value || null, regions: ['서울', '경기', '인천'].filter(r => $(`rg-${r}`).checked), maxPrice: won('maxp') },
    };
  }

  // 화면에 없는 값(배우자 통장 등)은 기존 값을 지킨다
  const merged = () => { const o = collect(), c = current || {};
    return { ...c, ...o, incomeTaxYears: { ...c.incomeTaxYears, ...o.incomeTaxYears }, accounts: { ...c.accounts, ...o.accounts }, prefs: { ...c.prefs, ...o.prefs } }; };
  $('save').onclick = () => {
    const out = merged();
    const err = [];
    if ($('married').checked && !out.marriageDate) err.push('혼인신고일을 넣어 주세요.');
    if ($('head').checked && !date('head-since')) err.push('세대주가 된 날을 넣어 주세요. 생애최초는 공고일 당시 세대주여야 해요.');
    if (!out.prefs.regions.length) err.push('관심 지역을 하나 이상 골라 주세요.');
    if (err.length) { $('hh-err').textContent = err.join(' '); $('hh-err').scrollIntoView({ block: 'center' }); return; }
    onSave(out);
  };
  $('reset').onclick = () => { $('hh-err').textContent = '정말 지우려면 한 번 더 누르세요.'; $('reset').onclick = () => onSave(null); };
  $('copy').onclick = async () => { const t = $('json'); t.value = JSON.stringify(merged()); try { await navigator.clipboard.writeText(t.value); $('copy').textContent = '복사됨'; } catch { t.select(); } };
  $('import').onclick = () => {
    try { const x = JSON.parse($('json').value.trim()); if (!x || typeof x !== 'object') throw 0; x.prefs = { regions: ['서울', '경기', '인천'], workplace: workplaces[0]?.id || null, ...(x.prefs || {}) }; onSave(x); }
    catch { $('hh-err').textContent = '코드 형식이 맞지 않아요. 복사한 코드를 그대로 붙여 넣어 주세요.'; }
  };
}
