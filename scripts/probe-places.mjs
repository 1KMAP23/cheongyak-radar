// 키워드로 카카오 장소 검색 (PROBE_QUERIES: ;로 구분). 지도 좌표 찾기용
const key = process.env.KAKAO_REST_KEY;
for (const q of (process.env.PROBE_QUERIES || '').split(';').map(s => s.trim()).filter(Boolean)) {
  const u = new URL('https://dapi.kakao.com/v2/local/search/keyword.json'); u.searchParams.set('query', q); u.searchParams.set('size', 5);
  const j = await (await fetch(u, { headers: { Authorization: 'KakaoAK ' + key } })).json();
  console.log('Q', q, '=>', (j.documents || []).map(d => `${d.place_name} [${d.category_name}] ${d.address_name} (${(+d.y).toFixed(5)},${(+d.x).toFixed(5)})`).join(' || ') || '없음');
}
