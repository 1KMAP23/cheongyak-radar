// 청약홈 원본 응답에서 이름으로 찾기 (필터 전). 누락 점검용
const key = process.env.DATA_GO_KR_KEY, q = (process.env.PROBE_NAME || '').replace(/\s/g, '');
const ops = ['getAPTLttotPblancDetail', 'getRemndrLttotPblancDetail', 'getOPTLttotPblancDetail', 'getUrbtyOfctlLttotPblancDetail'];
const since = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
for (const op of ops) {
  const u = new URL('https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/' + op);
  u.searchParams.set('serviceKey', key); u.searchParams.set('perPage', 1000); u.searchParams.set('cond[RCRIT_PBLANC_DE::GTE]', since);
  const j = await (await fetch(u)).json();
  const rows = j.data || [];
  const latest = rows.map(r => r.RCRIT_PBLANC_DE).sort().at(-1);
  console.log('OP', op, 'rows', rows.length, 'match', j.matchCount, 'latest공고일', latest);
  for (const r of rows.filter(r => String(r.HOUSE_NM || '').replace(/\s/g, '').includes(q))) console.log('RAW', op, JSON.stringify(r));
  // 강동구 공고도 같이
  for (const r of rows.filter(r => /강동구/.test(r.HSSPLY_ADRES || ''))) console.log('GANGDONG', op, r.HOUSE_NM, r.RCRIT_PBLANC_DE, r.HOUSE_SECD_NM, r.HOUSE_DTL_SECD_NM || '');
}
