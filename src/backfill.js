'use strict';

// 초기 전체 백필 스크립트
// 사용법: npm run backfill
// 기능: 종목 마스터 → 일봉 2년치 → 재무 → 점수

const { initSchema } = require('./db/init');
const { runUpdate, refreshStocks, refreshPricesForAll, refreshFundamentalsForAll } = require('./scheduler/jobs');
const cfg = require('./config');

(async () => {
  console.log('[backfill] 시작');
  await initSchema();

  console.log('[backfill] 1) 종목 목록');
  const n1 = await refreshStocks();
  console.log(`       → ${n1}개 종목 등록`);

  console.log('[backfill] 2) 일봉 (2년치, 시간이 가장 오래 걸림)');
  const n2 = await refreshPricesForAll();
  console.log(`       → ${n2} 행 저장`);

  console.log('[backfill] 3) 재무');
  const n3 = await refreshFundamentalsForAll();
  console.log(`       → ${n3} 행 저장`);

  console.log('[backfill] 4) 점수 계산');
  const result = await runUpdate({ skipStocks: true, skipPrices: true, skipFundamentals: true });
  console.log(`[backfill] 완료. ${result.scoreN} 종목 점수 산출`);

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
