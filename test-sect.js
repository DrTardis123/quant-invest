const axios = require('axios');
const iconv = require('iconv-lite');
(async () => {
  const r = await axios.get('https://finance.naver.com/item/main.naver?code=005930', { responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' } });
  const html = iconv.decode(Buffer.from(r.data), 'EUC-KR');
  // 섹터/업종 패턴 찾기
  const patterns = [
    /<a[^>]*href="\/item\/sise\.naver\?[^"]*sosok[^"]*"[^>]*>([^<]+)<\/a>/g,
    /<a[^>]*href="\/sise\/sise_group[^"]*"[^>]*>([^<]+)<\/a>/g,
    /<th[^>]*>업종명<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/,
    /<th[^>]*>분류<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      console.log('match:', m[0].substring(0, 200));
      console.log('---');
    }
  }
  // '섹터' 또는 '업종' 주변 텍스트 200자 추출
  const idx = html.search(/업종|섹터|분류/);
  if (idx >= 0) console.log('context:', html.substring(Math.max(0, idx-50), idx+300));
})().catch(e => console.error(e.message));
