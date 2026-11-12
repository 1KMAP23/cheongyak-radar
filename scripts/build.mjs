// web/ 정적 파일 + 푸시용 요약을 dist/로 복사
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
const r = JSON.parse(readFileSync('dist/report.json', 'utf8'));
// 요약에는 단지명·개수만 (세대 정보 없음). 푸시 문구용이며 배포 폴더에는 넣지 않는다.
writeFileSync('dist/summary.json', JSON.stringify({ ...r.summary, to: r.range.to, warnings: r.warnings.length }));
cpSync('web', 'dist/site', { recursive: true });
writeFileSync('dist/site/version.txt', r.generatedAt);
