// 점검용: 임대 공고 소스가 GitHub 서버에서 열리는지, 어떤 필드가 오는지 (비밀값·개인정보 출력 없음)
const KEY = process.env.DATA_GO_KR_KEY;
const show = (t, v) => console.log(`\n=== ${t}\n${typeof v === 'string' ? v : JSON.stringify(v, null, 1)}`.slice(0, 3500));
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
const since = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
try {
  const rows = [];
  for (let p = 1; p <= 10; p++) {
    const u = new URL('https://apis.data.go.kr/B552555/lhLeaseNoticeInfo1/lhLeaseNoticeInfo1');
    u.searchParams.set('serviceKey', KEY); u.searchParams.set('PG_SZ', 500); u.searchParams.set('PAGE', p);
    u.searchParams.set('PAN_ST_DT', since); u.searchParams.set('PAN_ED_DT', today);
    const j = JSON.parse((await (await fetch(u)).text()).trim());
    const list = (j.find?.(x => x.dsList) || {}).dsList || [];
    rows.push(...list); if (!list.length || rows.length >= +(list[0]?.ALL_CNT || 0)) break;
  }
  const types = {};
  for (const r of rows) { const k = `${r.UPP_AIS_TP_CD}/${r.AIS_TP_CD} ${r.UPP_AIS_TP_NM || ''}/${r.AIS_TP_CD_NM}`; types[k] = (types[k] || 0) + 1; }
  show('LH 유형별 건수 (최근 60일)', types);
  show('LH 첫 행 필드', Object.keys(rows[0] || {}));
  const rent = rows.filter(r => /서울|경기|인천/.test(r.CNP_CD_NM) && !['05', '39'].includes(r.AIS_TP_CD) && r.PAN_SS !== '접수마감').slice(0, 12);
  show('LH 수도권 임대 진행 예시', rent.map(r => `${r.AIS_TP_CD_NM} | ${r.PAN_NM} | ${r.PAN_SS} | ${r.PAN_DT}~${r.CLSG_DT} | SPL=${r.SPL_INF_TP_CD} CCR=${r.CCR_CNNT_SYS_DS_CD} UPP=${r.UPP_AIS_TP_CD}`));
  const one = rent.find(r => /행복|국민|영구|통합|장기/.test(r.AIS_TP_CD_NM)) || rent[0];
  if (one) {
    for (const [svc, op] of [['lhLeaseNoticeSplInfo1', 'getLeaseNoticeSplInfo1'], ['lhLeaseNoticeDtlInfo1', 'getLeaseNoticeDtlInfo1']]) {
      const u = new URL(`https://apis.data.go.kr/B552555/${svc}/${op}`);
      u.searchParams.set('serviceKey', KEY);
      for (const [k, v] of Object.entries({ SPL_INF_TP_CD: one.SPL_INF_TP_CD, CCR_CNNT_SYS_DS_CD: one.CCR_CNNT_SYS_DS_CD, PAN_ID: one.PAN_ID, UPP_AIS_TP_CD: one.UPP_AIS_TP_CD, AIS_TP_CD: one.AIS_TP_CD })) if (v) u.searchParams.set(k, v);
      const r = await fetch(u); const t = await r.text();
      show(`LH ${svc} (${one.PAN_NM}) HTTP ${r.status}`, t.slice(0, 3000));
    }
  }
} catch (e) { show('LH 오류', String(e)); }
for (const [name, url, opt] of [
  ['SH 임대 공고 목록', 'https://www.i-sh.co.kr/main/lay2/program/S1T294C297/www/brd/m_247/list.do'],
  ['SH 공고 목록2', 'https://www.i-sh.co.kr/houseinfo/main/mainPage.do'],
  ['GH 분양임대 공고', 'https://www.gh.or.kr/gh/announcement-of-salerental001.do'],
  ['iH 공고', 'https://www.ih.co.kr/main/bbs/bbsMsgList.do?bcd=notice'],
  ['마이홈 공고 목록 JSON', 'https://www.myhome.go.kr/hws/portal/sch/selectRsdtRcritNtcList.do', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'pageIndex=1&srchSuplyTy=&srchBrtcCode=' }],
  ['마이홈 공고 화면', 'https://www.myhome.go.kr/hws/portal/sch/selectRsdtRcritNtcView.do'],
]) {
  try { const r = await fetch(url, opt); const t = await r.text(); show(`${name} HTTP ${r.status} (${t.length}자)`, t.replace(/\s+/g, ' ').slice(0, 2500)); }
  catch (e) { show(`${name} 실패`, String(e.cause?.code || e.message)); }
}
