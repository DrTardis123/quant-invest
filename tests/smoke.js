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
  // 7팩터 가중치: 특정 숫자를 박아두지 않고 "지켜야 할 계약" 을 검증한다.
  //  (1) cfg.factors.weights 는 strategies.balanced 와 동일해야 한다.
  //      → scripts/update.js 가 만드는 total_score 와 대시보드 기본 프로파일이 어긋나지 않게.
  //  (2) 모든 프로파일의 가중치 합은 100 이어야 한다.
  //  (3) 7개 팩터 키가 빠짐없이 있어야 한다. (빠지면 reweight 에서 조용히 0점 처리됨)
  const strategies = require('../src/strategies');
  const FACTOR_KEYS = ['value', 'momentum', 'quality', 'volatility', 'growth', 'liquidity', 'supply'];
  const W = cfg.factors.weights;
  const B = strategies.get('balanced').weights;
  ok(
    FACTOR_KEYS.every((k) => W[k] === B[k]),
    `cfg.factors.weights === strategies.balanced (${JSON.stringify(W)})`,
  );
  for (const s of strategies.list()) {
    const keys = Object.keys(s.weights);
    ok(
      FACTOR_KEYS.every((k) => Number.isFinite(s.weights[k])),
      `'${s.key}' 프로파일에 7팩터 키 모두 존재 (${keys.length}개)`,
    );
    const sum = FACTOR_KEYS.reduce((a, k) => a + s.weights[k], 0);
    ok(sum === 100, `'${s.key}' 가중치 합 100 (현재 ${sum})`);
  }
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
