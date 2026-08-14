'use strict';

// 5가지 전략 프로파일 (7팩터)
// 가중치 합 = 100
// 2026-08-14 업데이트: 단일 팩터 OOS 3개월 + 듀얼 팩터 OOS 기반
// - liquidity 단일 Sharpe 1.47, value+liquidity 50:50 OOS test Sharpe 1.93 (+21.99% / KOSPI -19.62%)
// - 균형(balanced)을 value+liquidity+momentum 중심으로 재구성
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
    description: 'OOS 가치 best 1개월 Sharpe 3.10. 가치 50 + 퀄리티 15 + 성장 10 + 모멘텀 10.',
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
