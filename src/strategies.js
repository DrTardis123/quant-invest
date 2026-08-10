'use strict';

// 5가지 전략 프로파일
// 가중치 합 = 100
const STRATEGIES = {
  balanced: {
    key: 'balanced',
    name: '밸런스',
    emoji: '⚖️',
    description: '가치 35 + 모멘텀 20 + 퀄리티 20 + 저변동 15 + 성장 10. 기본값.',
    weights: { value: 35, momentum: 20, quality: 20, volatility: 15, growth: 10 },
  },
  value: {
    key: 'value',
    name: '가치 강화',
    emoji: '💎',
    description: '그레이엄/버핏 스타일. 저PER·저PBR + ROE 필터.',
    weights: { value: 50, momentum: 10, quality: 25, volatility: 5, growth: 10 },
  },
  growth: {
    key: 'growth',
    name: '성장 강화',
    emoji: '🚀',
    description: '고성장 종목 위주. 모멘텀 + 매출·EPS 성장률 중시.',
    weights: { value: 10, momentum: 30, quality: 20, volatility: 10, growth: 30 },
  },
  momentum: {
    key: 'momentum',
    name: '모멘텀',
    emoji: '📈',
    description: 'Jegadeesh-Titman 12-1 모멘텀 추종.',
    weights: { value: 15, momentum: 40, quality: 15, volatility: 10, growth: 20 },
  },
  defensive: {
    key: 'defensive',
    name: '방어형',
    emoji: '🛡️',
    description: '하락장 방어. 퀄리티 + 저변동성 중시.',
    weights: { value: 25, momentum: 5, quality: 30, volatility: 30, growth: 10 },
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
