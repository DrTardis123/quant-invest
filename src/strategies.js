'use strict';

// 5가지 전략 프로파일 (7팩터)
// 가중치 합 = 100
// 2026-08-15 업데이트: 2차 회귀분석 + 5-Fold CV + Risk Parity 기반
// - 가치(50) 가중치가 종합 점수 (Sharpe + Alpha - MDD×5) 최고
// - Ridge λ=500: momentum 28 + volatility 43 + liquidity 29 (Sharpe 1.27)
// - OOS K-fold best: 가치/퀄리티/성장/수급 균등 25% (4팩터, 인샤풀 13개월 안정성)
const STRATEGIES = {
  balanced: {
    key: 'balanced',
    name: '밸런스',
    emoji: '⚖️',
    description: 'OOS 3개월 test Sharpe 1.93 기반. 가치 25 + 유동 25 + 모멘텀 20 + 퀄리티 10 + 성장 10 + 저변동 5 + 수급 5.',
    weights: { value: 25, momentum: 20, quality: 10, volatility: 5, growth: 10, liquidity: 25, supply: 5 },
  },
  value: {
    key: 'value',
    name: '가치 강화',
    emoji: '💎',
    description: '2차 회귀 종합 1위. 가치 50 + 퀄리티 15 + 성장 10 + 모멘텀 10. 인샤풀 Sharpe 1.24, MDD -8.6%.',
    weights: { value: 50, momentum: 10, quality: 15, volatility: 5, growth: 10, liquidity: 5, supply: 5 },
  },
  growth: {
    key: 'growth',
    name: '성장 강화',
    emoji: '🚀',
    description: '고성장 종목. 성장 35 + 퀄리티 25 + 모멘텀 20 + 유동 5 + 수급 5.',
    weights: { value: 5, momentum: 20, quality: 25, volatility: 5, growth: 35, liquidity: 5, supply: 5 },
  },
  momentum: {
    key: 'momentum',
    name: '모멘텀',
    emoji: '📈',
    description: '12-1 모멘텀 + 수급 추종. 모멘텀 40 + 퀄리티 20 + 성장 15 + 수급 10.',
    weights: { value: 5, momentum: 40, quality: 20, volatility: 5, growth: 15, liquidity: 5, supply: 10 },
  },
  defensive: {
    key: 'defensive',
    name: '방어형',
    emoji: '🛡️',
    description: '하락장 방어. 퀄리티 35 + 저변동 25 + 성장 15 + 가치 15 + 유동 5.',
    weights: { value: 15, momentum: 5, quality: 35, volatility: 25, growth: 15, liquidity: 5, supply: 0 },
  },
  factor4: {
    key: 'factor4',
    name: '4팩터 균등',
    emoji: '🎯',
    description: 'OOS K-fold best 4팩터 균등. 가치/퀄리티/성장/수급 각 25%. 인샤풀 13개월 안정성.',
    weights: { value: 25, momentum: 0, quality: 25, volatility: 0, growth: 25, liquidity: 0, supply: 25 },
  },
};

function get(key) {
  return STRATEGIES[key] || STRATEGIES.balanced;
}

function list() {
  return Object.values(STRATEGIES);
}

function defaultKey() {
  return 'balanced';
}

module.exports = { STRATEGIES, get, list, defaultKey };
