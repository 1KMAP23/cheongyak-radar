// 한국부동산원 청약홈 분양정보 조회 서비스 (odcloud)
// 필드명은 2026-11-12 실제 응답으로 확인함.
const BASE = 'https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/';

// 수도권 청약 지역코드: 100 서울, 400 인천, 410 경기
export const METRO = new Set(['서울', '인천', '경기']);

const OPS = {
  apt:      { detail: 'getAPTLttotPblancDetail',      model: 'getAPTLttotPblancMdl' },
  remndr:   { detail: 'getRemndrLttotPblancDetail',   model: 'getRemndrLttotPblancMdl' },
  // OPT 계열: 임의공급 + 오피스텔·도시형생활주택·생활숙박시설·민간임대가 섞여 옴 → HOUSE_SECD_NM으로 나눔 (민간임대는 분양이 아니라 뺌)
  opt:      { detail: 'getOPTLttotPblancDetail',      model: 'getOPTLttotPblancMdl' },
  // 오피스텔·도시형생활주택·생활숙박시설·민간임대 (아파트가 아닌 상품)
  urbty:    { detail: 'getUrbtyOfctlLttotPblancDetail', model: 'getUrbtyOfctlLttotPblancMdl', optional: true },
};

async function page(op, key, params, pageNo, perPage = 500) {
  const u = new URL(BASE + op);
  u.searchParams.set('serviceKey', key);
  u.searchParams.set('page', pageNo);
  u.searchParams.set('perPage', perPage);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u);
  if (!r.ok) throw new Error(`${op} HTTP ${r.status}`);
  return r.json();
}

async function all(op, key, params) {
  const out = [];
  for (let p = 1; ; p++) {
    const j = await page(op, key, params, p);
    out.push(...(j.data || []));
    if (out.length >= j.matchCount || !j.data?.length) return { rows: out, total: j.matchCount };
  }
}

// 날짜 문자열을 YYYY-MM-DD로 통일 (API마다 '2026-11-16' / '20261116' 섞여 옴)
export const d = s => (!s ? null : s.includes('-') ? s : `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`);

function windowOf(row) {
  const dates = [
    row.SPSPLY_RCEPT_BGNDE, row.SPSPLY_RCEPT_ENDDE,
    row.RCEPT_BGNDE, row.RCEPT_ENDDE,
    row.GNRL_RNK1_CRSPAREA_RCPTDE, row.GNRL_RNK2_ETC_AREA_ENDDE,
    row.SUBSCRPT_RCEPT_BGNDE, row.SUBSCRPT_RCEPT_ENDDE,
    row.GNRL_RCEPT_BGNDE, row.GNRL_RCEPT_ENDDE,
  ].map(d).filter(Boolean).sort();
  return { start: dates[0] || null, end: dates.at(-1) || null };
}

/**
 * 공고일이 since 이후이고 접수가 아직 안 끝난(끝나는 날 ≥ from) 수도권 공고를 전부 가져온다. to는 쓰지 않는다.
 * since는 넉넉하게(기본 60일 전) 잡아서 공고는 오래전에 났지만 접수가 이번 주인 건도 놓치지 않는다.
 */
export async function collectApplyhome({ key, from, to, sinceDays = 60, log = console.log }) {
  const since = new Date(Date.parse(from) - sinceDays * 864e5).toISOString().slice(0, 10);
  const items = [];
  const stats = {};

  for (const [kind, op] of Object.entries(OPS)) {
    let rows, total;
    try { ({ rows, total } = await all(op.detail, key, { 'cond[RCRIT_PBLANC_DE::GTE]': since })); }
    catch (e) { if (!op.optional) throw e; log(`[applyhome] ${kind}: 조회 실패 ${e.message}`); stats[kind] = { error: e.message }; continue; }
    let kept = 0;
    const types = {};
    for (const row of rows) {
      if (!METRO.has(row.SUBSCRPT_AREA_CODE_NM) && !/^(서울|경기|인천)/.test(row.HSSPLY_ADRES || '')) continue;
      const t = String(row.HOUSE_SECD_NM || '');
      if (kind === 'opt' || kind === 'urbty') types[t] = (types[t] || 0) + 1;
      // 아파트가 아닌 상품: 오피스텔 / 도시형생활주택 / 생활숙박시설. 민간임대·공공지원임대는 분양이 아니라 제외
      const propertyType = kind === 'apt' || kind === 'remndr' ? null : /오피스텔/.test(t) ? '오피스텔' : /도시형/.test(t) ? '도시형생활주택' : /생활숙박|생숙/.test(t) ? '생활숙박시설' : null;
      if (kind === 'opt' && t !== '임의공급' && !propertyType) continue;
      if (kind === 'urbty' && !propertyType) continue; // 민간임대 등
      const w = windowOf(row);
      // 접수가 끝나지 않은 공고는 전부 (오늘 새로 나와서 접수가 2~3주 뒤인 공고도 포함)
      if (!w.end || w.end < from) continue;
      items.push({
        source: 'applyhome', kind,
        id: `${row.HOUSE_MANAGE_NO}-${row.PBLANC_NO}`,
        houseManageNo: row.HOUSE_MANAGE_NO,
        pblancNo: row.PBLANC_NO,
        name: row.HOUSE_NM,
        typeName: row.HOUSE_SECD_NM,           // APT / 신혼희망타운 / 무순위 / 임의공급 / 오피스텔 ...
        propertyType,                          // 아파트가 아니면 '오피스텔' 등
        detailType: row.HOUSE_DTL_SECD_NM || null, // 민영 / 국민
        region: row.SUBSCRPT_AREA_CODE_NM || (row.HSSPLY_ADRES || '').match(/^(서울|경기|인천)/)?.[1] || null,
        address: row.HSSPLY_ADRES,
        totalUnits: row.TOT_SUPLY_HSHLDCO,
        noticeDate: d(row.RCRIT_PBLANC_DE),
        window: w,
        schedule: {
          special: [d(row.SPSPLY_RCEPT_BGNDE), d(row.SPSPLY_RCEPT_ENDDE)],
          rank1: [d(row.GNRL_RNK1_CRSPAREA_RCPTDE), d(row.GNRL_RNK1_ETC_AREA_ENDDE)],
          rank2: [d(row.GNRL_RNK2_CRSPAREA_RCPTDE), d(row.GNRL_RNK2_ETC_AREA_ENDDE)],
          single: [d(row.SUBSCRPT_RCEPT_BGNDE), d(row.SUBSCRPT_RCEPT_ENDDE)],
          winners: d(row.PRZWNER_PRESNATN_DE),
          contract: [d(row.CNTRCT_CNCLS_BGNDE), d(row.CNTRCT_CNCLS_ENDDE)],
        },
        moveIn: row.MVN_PREARNGE_YM || null,
        flags: {
          speculativeZone: row.SPECLT_RDN_EARTH_AT === 'Y',   // 투기과열지구
          priceCap: row.PARCPRC_ULS_AT === 'Y',               // 분양가상한제
          publicLand: row.PUBLIC_HOUSE_EARTH_AT === 'Y',      // 공공택지
          largeSite: row.LRSCL_BLDLND_AT === 'Y',
          adjustArea: row.MDAT_TRGET_AREA_SECD === 'Y',       // 조정대상지역
        },
        builder: row.CNSTRCT_ENTRPS_NM || null,
        developer: row.BSNS_MBY_NM || null,
        phone: row.MDHS_TELNO || null,
        noticeUrl: row.PBLANC_URL,
        homepage: row.HMPG_ADRES || null,
        models: [],
        _modelOp: op.model,
      });
      kept++;
    }
    stats[kind] = { fetched: rows.length, total, kept, ...(kind === 'opt' || kind === 'urbty' ? { types } : {}) };
    log(`[applyhome] ${kind}: 전체 ${total} / 수도권·기간 해당 ${kept}${kind === 'opt' || kind === 'urbty' ? ` · 수도권 유형 ${JSON.stringify(types)}` : ''}`);
    if (kind === 'urbty' && rows[0]) log(`[applyhome] urbty 필드: ${Object.keys(rows[0]).join(',')}`);
  }

  // 주택형별 분양가·특공 세대수 (공고별로 조회)
  for (const it of items) {
    let rows = [];
    try { ({ rows } = await all(it._modelOp, key, { 'cond[HOUSE_MANAGE_NO::EQ]': it.houseManageNo })); }
    catch (e) { if (!it.propertyType) throw e; }
    if (it.propertyType && rows[0]) log(`[applyhome] ${it.propertyType} 주택형 필드: ${Object.keys(rows[0]).join(',')}`);
    it.models = rows.map(m => ({
      type: (m.HOUSE_TY || '').trim(),                         // 예: 084.9600A
      exclusiveArea: parseFloat(m.HOUSE_TY) || parseFloat(m.EXCLUSE_AR) || null, // 전용면적 (오피스텔은 EXCLUSE_AR)
      supplyArea: parseFloat(m.SUPLY_AR) || null,              // 공급면적
      pyeong: m.SUPLY_AR ? +(parseFloat(m.SUPLY_AR) / 3.3058).toFixed(1) : null,
      topPrice: (v => (v ? parseInt(String(v).replace(/,/g, ''), 10) * 10000 : null))(m.LTTOT_TOP_AMOUNT || m.SUPLY_AMOUNT),
      general: m.SUPLY_HSHLDCO ?? null,
      special: m.SPSPLY_HSHLDCO ?? null,
      specialBreakdown: {
        multiChild: m.MNYCH_HSHLDCO, newlywed: m.NWWDS_HSHLDCO, firstLife: m.LFE_FRST_HSHLDCO,
        oldParents: m.OLD_PARNTS_SUPORT_HSHLDCO, institution: m.INSTT_RECOMEND_HSHLDCO,
        newborn: m.NWBB_HSHLDCO, youth: m.YGMN_HSHLDCO, other: m.ETC_HSHLDCO,
      },
    }));
    delete it._modelOp;
  }

  return { items, stats };
}
