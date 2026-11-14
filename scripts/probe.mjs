// 점검용: SH·GH 공고 목록 구조 (공개 웹페이지)
const strip = h => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
for (const [name, url] of [
  ['SH m_247', 'https://www.i-sh.co.kr/main/lay2/program/S1T294C297/www/brd/m_247/list.do'],
  ['GH', 'https://www.gh.or.kr/gh/announcement-of-salerental001.do'],
]) {
  const t = strip(await (await fetch(url)).text());
  const rows = [...t.matchAll(/<tr[\s\S]*?<\/tr>/g)].map(m => m[0]);
  console.log(`\n=== ${name} tr ${rows.length}개`);
  for (const r of rows.slice(0, 14)) console.log('ROW', r.replace(/\s+/g, ' ').slice(0, 700));
  const forms = [...t.matchAll(/<form[^>]*>/g)].map(m => m[0]).slice(0, 5);
  console.log('FORMS', forms.join(' | '));
  const sel = [...t.matchAll(/<select[\s\S]*?<\/select>/g)].map(m => m[0].replace(/\s+/g, ' ').slice(0, 600)).slice(0, 4);
  console.log('SELECTS', sel.join('\n'));
}
