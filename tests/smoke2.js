'use strict';

// 새 모듈 (strategies, scoring) 검증

(async () => {
  const ok = (cond, msg) => {
    if (!cond) { console.error('✗', msg); process.exit(1); }
    console.log('✓', msg);
  };

  // 1) strategies 모듈 (7팩터)
  const strategies = require('../src/strategies');
  ok(strategies.list().length === 5, '전략 5개');
  ok(strategies.get('balanced').weights.value === 8, '밸런스 가치 8');
  ok(strategies.get('value').weights.value === 35, '가치 전략 가치 35');
  ok(strategies.get('momentum').weights.momentum === 40, '모멘텀 전략 40');
  // 7팩터 합 = 100
  for (const k of Object.keys(strategies.STRATEGIES)) {
    const sum = Object.values(strategies.STRATEGIES[k].weights).reduce((a, b) => a + b, 0);
    ok(sum === 100, `${k} 가중치 합 100 (현재 ${sum})`);
  }

  // 2) scoring 모듈
  const scoring = require('../src/scoring');
  ok(typeof scoring.gradeFor === 'function', 'gradeFor 함수');
  ok(scoring.gradeFor(85).letter === 'A+', 'A+ 등급');
  ok(scoring.gradeFor(65).letter === 'B+', 'B+ 등급');
  ok(scoring.gradeFor(25).letter === 'F', 'F 등급');

  // 3) pearson
  const x = [1, 2, 3, 4, 5];
  const y = [2, 4, 6, 8, 10];
  ok(Math.abs(scoring.pearson(x, y) - 1) < 0.001, '완전 양의 상관 = 1');
  ok(Math.abs(scoring.pearson(x, y.map(v => -v)) - (-1)) < 0.001, '완전 음의 상관 = -1');

  // 4) recomputeWithWeights
  const rows = [
    { code: 'A', value_score: 80, momentum_score: 50, quality_score: 60, volatility_score: 70, growth_score: 40 },
    { code: 'B', value_score: 30, momentum_score: 90, quality_score: 50, volatility_score: 40, growth_score: 70 },
  ];
  const balanced = strategies.get('balanced').weights;
  const result = scoring.recomputeWithWeights(rows, balanced);
  ok(result[0].recomputed_total > result[1].recomputed_total, '밸런스 가중치에서 A가 B보다 높음');
  ok(result[0].recomputed_rank === 1, 'A가 1위');

  const valueWeights = strategies.get('value').weights;
  const valueResult = scoring.recomputeWithWeights(rows, valueWeights);
  // value 80 > value 30 이므로 A가 더 높아야 함
  ok(valueResult[0].recomputed_total > valueResult[1].recomputed_total, '가치 가중치에서도 A가 더 높음');

  console.log('\n✅ 새 모듈 검증 통과');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
