'use strict';

// 5가지 전략 프로파일 (7팩터)
// 가중치 합 = 100
// 2026-08-13 업데이트: optimize-weights.js 13개월 시뮬 기반
// - Sharpe-균형 (Sharpe 1.61, Total 60.4%, MDD -14%)을 balanced로 채택
// - 가치/모멘텀/퀄리티/저변동 균형, 거래량/수급은 보조
const STRATEGIES = {
  balanced: {
    key: 'balanced',
    name: '밸런스',
    emoji: '⚖️',
    description: 'Sharpe 1.61 최적 균형. 가치 10 + 모멘텀 25 + 퀄리티 25 + 저변동 15 + 성장 15 + 유동 5 + 수급 5.',
    weights: { value: 10, momentum: 25, quality: 25, volatility: 15, growth: 15, liquidity: 5, supply: 5 },
  },
  value: {
    key: 'value',
    name: '가치 강화',
    emoji: '💎',
    description: '그레이엄/버핏 스타일. 가치 35 + 퀄리티 30 + 성장 15 + 유동 5 + 수급 5.',
    weights: { value: 35, momentum: 5, quality: 30, volatility: 5, growth: 15, liquidity: 5, supply: 5 },
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
