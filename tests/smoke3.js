'use strict';

// optimizer / backtest 모듈 단위 테스트
const { solveOLS, regressionWeights, backtestStrategy } = require('../src/scoring/optimizer');

const ok = (cond, msg) => {
  if (!cond) { console.error('✗', msg); process.exit(1); }
  console.log('✓', msg);
};

// 1) OLS 가우시안 소거법 검증
const X = [[1,1,2,3,1,2], [1,2,3,4,2,1], [1,1,1,2,1,1], [1,3,4,5,2,3], [1,2,2,3,1,2]];
const y = [10, 20, 8, 25, 15];
const coef = solveOLS(X, y);
ok(Array.isArray(coef) && coef.length === 6, 'OLS가 6개 계수 반환');
ok(coef.every((v) => Number.isFinite(v)), '모든 계수가 유한수');

// 2) 회귀분석 가중치 (양수만, 정규화)
const data = [];
for (let d = 0; d < 12; d++) {
  for (let s = 0; s < 50; s++) {
    data.push({
      date: '2025-' + String(d + 1).padStart(2, '0') + '-01',
      code: 'A' + s,
      value: 50 + Math.random() * 30,
      momentum: 50 + Math.random() * 30,
      quality: 50 + Math.random() * 30,
      volatility: 50 + Math.random() * 30,
      growth: 50 + Math.random() * 30,
      fwdReturn: (Math.random() - 0.5) * 0.1,
    });
  }
}
const reg = regressionWeights(data);
ok(reg && reg.weights, '회귀분석 가중치 생성');
const sum = reg.weights.value + reg.weights.momentum + reg.weights.quality + reg.weights.volatility + reg.weights.growth;
ok(Math.abs(sum - 100) <= 1, `가중치 합 ≈ 100 (실제 ${sum})`);
ok(reg.r2 >= 0 && reg.r2 <= 1, `R² ∈ [0,1] (실제 ${reg.r2})`);

// 3) 백테스트 함수 검증
const bt = backtestStrategy(data, { value: 50, momentum: 20, quality: 20, volatility: 5, growth: 5 });
ok(bt && typeof bt.totalReturn === 'number', '백테스트 totalReturn 반환');
ok(bt && typeof bt.sharpe === 'number', '백테스트 sharpe 반환');
ok(bt && typeof bt.mdd === 'number' && bt.mdd <= 0, '백테스트 mdd ≤ 0');

// 4) 인덱스 모듈 검증
const indices = require('../src/data/indices');
ok(typeof indices.getAllIndices === 'function', 'getAllIndices 함수 존재');
ok(typeof indices.getIndexHistory === 'function', 'getIndexHistory 함수 존재');

// 5) 백테스트 모듈 검증
const backtestMod = require('../src/scoring/backtest');
ok(typeof backtestMod.backtest === 'function', 'backtest 함수 존재');

console.log('\n✅ 옵티마이저/백테스트 검증 통과');
process.exit(0);
