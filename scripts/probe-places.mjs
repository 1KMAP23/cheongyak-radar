// 키워드로 카카오 장소 검색 (PROBE_QUERIES: ;로 구분). 지도 좌표 찾기용
const key = process.env.KAKAO_REST_KEY;
for (const q of (process.env.PROBE_QUERIES || '').split(';').map(s => s.trim()).filter(Boolean)) {
  const u = new URL('https://dapi.kakao.com/v2/local/search/keyword.json'); u.searchParams.set('query', q); u.searchParams.set('size', 5);
  const j = await (await fetch(u, { headers: { Authorization: 'KakaoAK ' + key } })).json();
  console.log('Q', q, '=>', (j.documents || []).map(d => `${d.place_name} [${d.category_name}] ${d.address_name} (${(+d.y).toFixed(5)},${(+d.x).toFixed(5)})`).join(' || ') || '없음');
}
// OSM에서 이름에 '왕숙'이 들어간 지물 (역·공사 부지 등)
if (process.env.PROBE_OSM) {
  const q = `[out:json];(node["name"~"왕숙"](37.60,127.10,37.72,127.22);way["name"~"왕숙"](37.60,127.10,37.72,127.22);node["railway"~"station|construction|proposed"](37.63,127.14,37.67,127.19););out center tags;`;
  const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', headers: { 'User-Agent': 'cheongyak-radar/1.0', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) });
  const j = await r.json();
  for (const e of j.elements) { const t = e.tags || {}, c = e.center || e; console.log('OSM', e.type, t.name, t.railway || t.landuse || t.construction || t.public_transport || t.highway || '', (+c.lat).toFixed(5), (+c.lon).toFixed(5)); }
}
