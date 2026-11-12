// web/ 정적 파일 + 푸시용 요약을 dist/로 복사
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
const r = JSON.parse(readFileSync('dist/report.json', 'utf8'));
// 요약에는 단지명·개수만 (세대 정보 없음). 푸시 문구용이며 배포 폴더에는 넣지 않는다.
cpSync('dist/push-summary.json', 'dist/summary.json');
cpSync('web', 'dist/site', { recursive: true });
writeFileSync('dist/site/version.txt', r.generatedAt);
// 아이폰이 옛 CSS·JS를 캐시로 계속 쓰지 않게 배포마다 버전을 붙인다
const v = Date.now().toString(36);
const idx = 'dist/site/index.html';
writeFileSync(idx, readFileSync(idx, 'utf8').replace('href="style.css"', `href="style.css?v=${v}"`).replace('src="app.js"', `src="app.js?v=${v}"`));
// 모듈이 불러오는 파일에도 같은 버전을 붙인다
const appjs = 'dist/site/app.js';
writeFileSync(appjs, readFileSync(appjs, 'utf8').replace("'./lib/rules.js'", `'./lib/rules.js?v=${v}'`).replace("'./household.js'", `'./household.js?v=${v}'`));
