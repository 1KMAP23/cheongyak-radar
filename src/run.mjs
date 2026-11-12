// 매일 실행 진입점: 수집 → (분석) → web/data/latest.json
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { collectApplyhome } from './collect/applyhome.mjs';

function loadEnv() {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

function kstToday() {
  return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
}

loadEnv();
const key = process.env.DATA_GO_KR_KEY;
if (!key) { console.error('DATA_GO_KR_KEY가 없습니다 (.env 확인)'); process.exit(1); }

const from = kstToday();
const to = new Date(Date.parse(from) + 9 * 864e5).toISOString().slice(0, 10); // 오늘~9일 뒤
const report = { generatedAt: new Date().toISOString(), range: { from, to }, sources: {}, items: [] };

try {
  const { items, stats } = await collectApplyhome({ key, from, to });
  report.items.push(...items);
  report.sources.applyhome = { ok: true, ...stats };
} catch (e) {
  report.sources.applyhome = { ok: false, error: String(e) };
  console.error('[applyhome] 실패', e);
}

// TODO 다음 단계: LH, 국토부 실거래가, 카카오(좌표·역·학교·출퇴근), 자격·투자 판정

report.items.sort((a, b) => (a.window.end || '').localeCompare(b.window.end || ''));
mkdirSync('web/data', { recursive: true });
writeFileSync('web/data/latest.json', JSON.stringify(report, null, 2));
console.log(`완료: ${report.items.length}건 → web/data/latest.json`);
