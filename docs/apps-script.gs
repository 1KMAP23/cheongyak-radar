/**
 * 청약 레이더 사용자 설정 수집용 Google Apps Script
 *
 * 설치: 새 Google 스프레드시트 → 확장 프로그램 → Apps Script → 이 파일 내용을 붙여 넣기
 *      → 프로젝트 설정(톱니) → 스크립트 속성에 TOKEN 추가(아무 긴 영문·숫자)
 *      → 배포 → 새 배포 → 유형 '웹 앱' → 실행: 나 / 액세스: 모든 사용자 → 배포 → 웹 앱 URL 복사
 * 고칠 때: 내용을 바꿔 붙여 넣고 저장 → 배포 → 배포 관리 → 연필 → 버전 '새 버전' → 배포 (URL은 그대로)
 *
 * 탭
 * - users : 한 사람(기기)당 한 줄. 저장할 때마다 최신 내용으로 덮어쓴다.
 * - 기록  : 저장할 때마다 한 줄씩 쌓인다 (언제 무엇을 바꿨는지 보기용).
 * 열: 앱이 보내는 [칸 이름, 값]을 그대로 쓴다. 처음 보는 칸 이름은 오른쪽에 새 열로 붙인다.
 *
 * - POST(앱에서 저장): uid, fields([[칸 이름, 값]...]), settings(원본), push(알림 구독)
 * - GET(?token=TOKEN): GitHub Actions가 매일 읽어 출퇴근 계산·개인 알림에 쓴다. TOKEN 없으면 거부.
 */
const FIXED = ['uid', '저장시각'];
const TAIL = ['설정 JSON', '알림 JSON'];

function tab_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  // 예전 형식(요약 열만 있던 users 탭)은 'users(이전)'으로 이름을 바꿔 보관하고 새로 만든다
  if (sh && name === 'users' && sh.getLastRow() > 0) {
    const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    if (h.indexOf('점수 비율') >= 0 && h.indexOf('신청자 생년월일') < 0) { sh.setName('users(이전)'); sh = null; }
  }
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) { sh.appendRow(FIXED.concat(TAIL)); sh.setFrozenRows(1); sh.setFrozenColumns(2); }
  return sh;
}

// 칸 이름 → 열 번호. 없으면 맨 오른쪽에 새 열을 만든다
function cols_(sh, names) {
  let head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const add = names.filter((n, i) => names.indexOf(n) === i && head.indexOf(n) < 0);
  if (add.length) { sh.getRange(1, head.length + 1, 1, add.length).setValues([add]); head = head.concat(add); }
  return head;
}

function rowFor_(head, map) { return head.map(h => (h in map ? map[h] : '')); }

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const d = JSON.parse(e.postData.contents);
    if (!d.uid || !/^[a-z0-9-]{8,40}$/.test(d.uid)) return out_('bad uid');
    const sh = tab_('users');
    const ids = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(r => r[0]) : [];
    const at = ids.indexOf(d.uid);
    if (d.delete) { if (at >= 0) sh.deleteRow(at + 2); return out_('deleted'); }

    const fields = Array.isArray(d.fields) ? d.fields.filter(f => Array.isArray(f) && f[0]) : [];
    const map = { uid: d.uid, '저장시각': new Date(), '설정 JSON': JSON.stringify(d.settings || {}).slice(0, 45000), '알림 JSON': d.push ? JSON.stringify(d.push) : '' };
    fields.forEach(f => { map[String(f[0]).slice(0, 60)] = typeof f[1] === 'string' ? f[1].slice(0, 2000) : f[1]; });
    const names = Object.keys(map);

    const head = cols_(sh, names);
    const row = rowFor_(head, map);
    if (at >= 0) sh.getRange(at + 2, 1, 1, row.length).setValues([row]); else sh.appendRow(row);

    // 기록 탭: 알림 JSON(구독 키)은 빼고 쌓는다
    const log = tab_('기록');
    const lmap = Object.assign({}, map); delete lmap['알림 JSON'];
    const lhead = cols_(log, Object.keys(lmap));
    log.appendRow(rowFor_(lhead, lmap));
    return out_('ok');
  } finally { lock.releaseLock(); }
}

function doGet(e) {
  const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!token || e.parameter.token !== token) return out_('forbidden');
  const users = [], seen = {};
  const read = (sh, legacy) => {
    if (!sh || sh.getLastRow() < 2) return;
    const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
    const h = v[0], iS = legacy ? 12 : h.indexOf('설정 JSON'), iP = legacy ? 13 : h.indexOf('알림 JSON');
    v.slice(1).forEach(r => { if (r[0] && !seen[r[0]]) { seen[r[0]] = 1; users.push({ uid: r[0], settings: safe_(r[iS]), push: safe_(r[iP]) }); } });
  };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  read(ss.getSheetByName('users'), false);
  read(ss.getSheetByName('users(이전)'), true); // 아직 새 형식으로 다시 저장하지 않은 사람
  return ContentService.createTextOutput(JSON.stringify({ users })).setMimeType(ContentService.MimeType.JSON);
}

const safe_ = t => { try { return t ? JSON.parse(t) : null; } catch (e) { return null; } };
const out_ = t => ContentService.createTextOutput(t);
