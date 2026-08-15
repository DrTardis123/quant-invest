// 실시간 시세 fetcher — TOP 20 종목의 현재가/등락률을 polling.finance.naver.com 에서 가져옴
// Vercel은 stateless, GitHub Actions cron에서 매시간 갱신
//
// 사용: node scripts/fetch-realtime.js
// 출력: public/data/realtime.json (다음 메트릭 갱신 시각 + top 20 시세 배열)
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);
const fs = require('fs');
const { getRealtimeBatch } = require('../src/data/naver');

async function main() {
  console.log('[realtime] 시작...');
  // 1) top.json 읽어서 top 20 코드 추출
  const topPath = path.join(ROOT, 'public', 'data', 'top.json');
  if (!fs.existsSync(topPath)) {
    console.error('[realtime] top.json 없음. update.js 먼저 실행하세요.');
    process.exit(1);
  }
  const top = JSON.parse(fs.readFileSync(topPath, 'utf8'));
  const codes = top.slice(0, 20).map((r) => r.code);
  console.log(`[realtime] ${codes.length}개 종목 폴링...`);

  // 2) Naver polling API 일괄 호출
  const quotes = await getRealtimeBatch(codes);
  if (quotes.length === 0) {
    console.error('[realtime] Naver 폴링 응답 없음 (장 마감 or network error)');
    process.exit(1);
  }

  // 3) top.json 매핑해서 name/sector 추가
  const codeMap = new Map(top.map((r) => [r.code, r]));
  const enriched = quotes.map((q) => {
    const t = codeMap.get(q.code) || {};
    return {
      code: q.code,
      name: t.name || '',
      sector: t.sector || '',
      close: q.close,
      change: q.change,
      change_pct: q.change_pct,
      volume: q.volume,
      market_cap: q.market_cap,
      rank: t.rank || 0,
    };
  });

  // 4) 저장
  const out = {
    asOf: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    n: enriched.length,
    quotes: enriched,
  };
  const outPath = path.join(ROOT, 'public', 'data', 'realtime.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`[realtime] realtime.json 저장 (${enriched.length}개)`);
  process.exit(0);
}

main().catch((e) => {
  console.error('[realtime] fatal:', e.message, e.stack);
  process.exit(1);
});
