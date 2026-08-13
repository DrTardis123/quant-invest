const axios = require('axios');
const UA = 'Mozilla/5.0';
async function main() {
  const r = await axios.get('https://finance.naver.com/item/frgn.naver?code=005930&page=1', {
    headers: {'User-Agent': UA}, responseType: 'arraybuffer', decompress: true
  });
  const html = Buffer.from(r.data).toString('utf8');
  const tables = [...html.matchAll(/<table[^>]+class="[^"]*type2[^"]*"[^>]*>([\s\S]*?)<\/table>/g)];
  console.log('tables:', tables.length);
  const t2 = tables[1][1];
  const rows = [...t2.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
  console.log('rows:', rows.length);
  for (let i = 3; i < 8; i++) {
    const row = rows[i][1];
    const hasDate = /(\d{4}\.\d{2}\.\d{2})/.test(row);
    const nums = [...row.matchAll(/<span[^>]+class="[^"]*tah[^"]*"[^>]*>([^<]+)<\/span>/g)].map(m => m[1].trim());
    console.log('row', i, 'hasDate:', hasDate, 'nums:', nums);
  }
}
main().catch(e => console.error('ERR:', e.message, e.stack));
