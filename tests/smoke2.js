'use strict';

// 새 모듈 (strategies, scoring) 검증

(async () => {
  const ok = (cond, msg) => {
    if (!cond) { console.error('✗', msg); process.exit(1); }
    console.log('✓', msg);
  };

  // 1) strategies 모듈 (7팩터)
  //    프로파일 개수/개별 숫자는 튜닝하면 바뀌므로 하드코딩하지 않고 구조만 검증한다.
  const strategies = require('../src/strategies');
  const FACTOR_KEYS = ['value', 'momentum', 'quality', 'volatility', 'growth', 'liquidity', 'supply'];
  ok(strategies.list().length >= 1, `전략 프로파일 ${strategies.list().length}개`);
  ok(strategies.get('없는키').key === 'balanced', '알 수 없는 키는 balanced 폴백');
  // 7팩터 합 = 100
  for (const k of Object.keys(strategies.STRATEGIES)) {
    const sum = Object.values(strategies.STRATEGIES[k].weights).reduce((a, b) => a + b, 0);
    ok(sum === 100, `${k} 가중치 합 100 (현재 ${sum})`);
  }

  // 1-b) 재계산 회귀 테스트: 7팩터가 **모두** 반영되는지
  //   과거 public/js/reweight.js 가 liquidity/supply 를 누락한 채 100 으로 나눠서
  //   화면 점수가 실제보다 ~30% 낮게 나오고 랭킹이 통째로 뒤바뀌었다. 다시 새지 않게 고정.
  const scoringMod = require('../src/scoring');
  {
    const row = {
      code: 'T', value_score: 100, momentum_score: 0, quality_score: 0,
      volatility_score: 0, growth_score: 0, liquidity_score: 100, supply_score: 100,
    };
    const W = { value: 25, momentum: 20, quality: 10, volatility: 5, growth: 10, liquidity: 25, supply: 5 };
    const got = scoringMod.recomputeWithWeights([row], W)[0].recomputed_total;
    ok(got === 55, `recomputeWithWeights 가 유동/수급 포함 (기대 55, 실제 ${got})`);
    // 가중치 합이 100이 아니어도 0~100 스케일 유지
    const half = scoringMod.recomputeWithWeights(
      [{ code: 'T', value_score: 80, momentum_score: 80 }], { value: 10, momentum: 10 },
    )[0].recomputed_total;
    ok(half === 80, `가중치 합 20 이어도 스케일 유지 (기대 80, 실제 ${half})`);
  }

  // 1-c) 서버(src/scoring) 와 프론트(public/js/reweight.js) 재계산 결과가 같아야 함
  {
    const fs = require('fs');
    const path = require('path');
    const sandbox = { window: {} };
    // eslint-disable-next-line no-new-func
    new Function('window', fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'reweight.js'), 'utf8'))(sandbox.window);
    const rows = [
      { code: 'A', value_score: 90, momentum_score: 10, quality_score: 50, volatility_score: 30, growth_score: 70, liquidity_score: 20, supply_score: 80 },
      { code: 'B', value_score: 10, momentum_score: 90, quality_score: 50, volatility_score: 70, growth_score: 30, liquidity_score: 95, supply_score: 5 },
    ];
    for (const s of strategies.list()) {
      const srv = scoringMod.recomputeWithWeights(rows, s.weights).map((r) => [r.code, r.recomputed_total]);
      const web = sandbox.window.recomputeWithWeights(rows, s.weights).map((r) => [r.code, r.recomputed_total]);
      ok(JSON.stringify(srv) === JSON.stringify(web), `'${s.key}' 서버/프론트 재계산 일치`);
    }
    void FACTOR_KEYS;
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
