// 청약홈 청약접수 경쟁률 (odcloud ApplyhomeInfoCmpetRtSvc). 활용신청 전이면 401 → 조용히 건너뛴다.
// 필드명은 신청 승인 후 실제 응답으로 확인해서 고정할 것. 지금은 경쟁률로 보이는 숫자 필드를 찾아 쓴다.
const BASE = 'https://api.odcloud.kr/api/ApplyhomeInfoCmpetRtSvc/v1/';
const OPS = { apt: 'getAPTLttotPblancCmpet', remndr: 'getRemndrLttotPblancCmpet', opt: 'getOPTLttotPblancCmpet' };
let disabled = null;

export async function competition(key, it) {
  if (disabled) return null;
  const op = OPS[it.kind];
  if (!op || !it.houseManageNo) return null;
  const u = `${BASE}${op}?serviceKey=${encodeURIComponent(key)}&page=1&perPage=200&${encodeURIComponent('cond[HOUSE_MANAGE_NO::EQ]')}=${it.houseManageNo}`;
  const r = await fetch(u);
  if (r.status === 401 || r.status === 403) { disabled = '경쟁률 API 활용신청 필요'; return null; }
  if (!r.ok) return null;
  const j = await r.json();
  const rows = j.data || [];
  if (!rows.length) return { rows: 0 };
  const rateKey = Object.keys(rows[0]).find(k => /CMPET_RATE|CMPETRT|RATE/i.test(k));
  const rates = rows.map(x => parseFloat(String(x[rateKey] ?? '').replace(/[^0-9.]/g, ''))).filter(n => !isNaN(n));
  return {
    rows: rows.length, field: rateKey,
    maxRate: rates.length ? Math.max(...rates) : null,
    avgRate: rates.length ? +(rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(1) : null,
  };
}
export const competitionStatus = () => disabled;
