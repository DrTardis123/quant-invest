'use strict';

// 환경/DB/팩터 모듈 로드 + 스키마 초기화 + 간단 쿼리만 검증.
// API 호출 없음. 종료 코드 0이면 통과.

(async () => {
  const ok = (cond, msg) => {
    if (!cond) { console.error('✗', msg); process.exit(1); }
    console.log('✓', msg);
  };

  const cfg = require('../src/config');
  ok(cfg.port === 3000, 'config.port 기본값 3000');
  ok(cfg.data.markets.includes('KOSPI'), 'config.data.markets 에 KOSPI');
  // 7팩터 가중치 (2026-08-13, 13개월 시뮬 기반 Sharpe 최적)
  const W = cfg.factors.weights;
  ok(W.value === 10, `가치 가중치 10 (현재 ${W.value})`);
  ok(W.momentum === 25, `모멘텀 가중치 25 (현재 ${W.momentum})`);
  ok(W.quality === 25, `퀄리티 가중치 25 (현재 ${W.quality})`);
  ok(W.volatility === 15, `저변동 가중치 15 (현재 ${W.volatility})`);
  ok(W.growth === 15, `성장 가중치 15 (현재 ${W.growth})`);
  ok(W.liquidity === 5, `유동 가중치 5 (현재 ${W.liquidity})`);
  ok(W.supply === 5, `수급 가중치 5 (현재 ${W.supply})`);
  ok(typeof cfg.isKisEnabled === 'function', 'isKisEnabled 함수 존재');

  const { initSchema } = require('../src/db/init');
  const db = require('../src/db/connection');
  await initSchema();
  console.log('✓ 스키마 초기화 완료');

  const tables = await db.all(`SHOW TABLES`);
  const names = tables.map((t) => Object.values(t)[0]);
  ok(names.includes('stocks'), 'stocks 테이블 존재');
  ok(names.includes('daily_prices'), 'daily_prices 테이블 존재');
  ok(names.includes('factor_scores'), 'factor_scores 테이블 존재');
  ok(names.includes('fundamentals'), 'fundamentals 테이블 존재');
  ok(names.includes('update_log'), 'update_log 테이블 존재');

  const cnt = await db.one(`SELECT COUNT(*) AS c FROM stocks`);
  console.log(`(현재 종목 수: ${cnt.c})`);

  await db.close();
  console.log('\n✅ 스모크 테스트 통과');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
