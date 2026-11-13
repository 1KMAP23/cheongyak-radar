/**
 * 청약 레이더 사용자 설정 수집용 Google Apps Script
 *
 * 설치: 새 Google 스프레드시트 → 확장 프로그램 → Apps Script → 이 파일 내용을 붙여 넣기
 *      → 프로젝트 설정(톱니) → 스크립트 속성에 TOKEN 추가(아무 긴 영문·숫자)
 *      → 배포 → 새 배포 → 유형 '웹 앱' → 실행: 나 / 액세스: 모든 사용자 → 배포 → 웹 앱 URL 복사
 *
 * - POST(앱에서 저장): 직장 주소·점수 비율·지역·알림 구독만 받는다. uid 기준으로 한 줄에 덮어쓴다.
 * - GET(?token=TOKEN): GitHub Actions가 매일 읽어 출퇴근 계산·개인 알림에 쓴다. TOKEN 없으면 거부.
 */
// 앱은 우리 집 정보(소득·자산 등)를 보내지 않는다. 직장 주소·점수 비율·지역·알림 구독만 받는다
const HEAD = ['uid', '저장시각', '지역', '직장 주소', '점수 비율', '알림', '설정 JSON', '알림 JSON'];

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('users') || ss.insertSheet('users');
  if (sh.getLastRow() === 0) { sh.appendRow(HEAD); sh.setFrozenRows(1); }
  return sh;
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const d = JSON.parse(e.postData.contents);
    if (!d.uid || !/^[a-z0-9-]{8,40}$/.test(d.uid)) return out_('bad uid');
    const sh = sheet_();
    const ids = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues().map(r => r[0]);
    const at = ids.indexOf(d.uid);
    if (d.delete) { if (at >= 0) sh.deleteRow(at + 2); return out_('deleted'); }
    const s = d.settings || {}, p = s.prefs || {};
    const row = [
      d.uid, new Date(), (p.regions || []).join('·'), String(p.workplaceAddress || p.workplace || '').slice(0, 100),
      p.weights ? `마진 ${p.weights.margin} · 출퇴근 ${p.weights.commute} · 입지 ${p.weights.location} · SNS ${p.weights.buzz}` : '기본',
      d.push ? '켬' : '끔', JSON.stringify(s).slice(0, 45000), d.push ? JSON.stringify(d.push) : '',
    ];
    if (at >= 0) sh.getRange(at + 2, 1, 1, row.length).setValues([row]); else sh.appendRow(row);
    return out_('ok');
  } finally { lock.releaseLock(); }
}

function doGet(e) {
  const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!token || e.parameter.token !== token) return out_('forbidden');
  const sh = sheet_();
  const rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, HEAD.length).getValues() : [];
  const users = rows.map(r => ({ uid: r[0], settings: safe_(r[6]), push: safe_(r[7]) })).filter(u => u.uid);
  return ContentService.createTextOutput(JSON.stringify({ users })).setMimeType(ContentService.MimeType.JSON);
}

const safe_ = t => { try { return t ? JSON.parse(t) : null; } catch (e) { return null; } };
const out_ = t => ContentService.createTextOutput(t);
