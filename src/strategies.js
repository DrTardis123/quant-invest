'use strict';

// 5가지 전략 프로파일
// 가중치 합 = 100
// 한국 시장 멀티팩터 실무 가중치 기반 (삼성증권·Morgan Stanley·quantgt.io 참고):
// - 재무제표(퀄리티+성장)가 가장 강력 (50-60%)
// - 가치(PER/PBR)는 2020년대 약세기 → 10-15%로 하향
// - 모멘텀은 꾸준한 효과 (15-25%)
// - 저변동성은 보너스 (5-15%)
const STRATEGIES = {
  balanced: {
    key: 'balanced',
    name: '밸런스',
    emoji: '⚖️',
    description: '가치 10 + 모멘텀 20 + 퀄리티 30 + 저변동 10 + 성장 30. 재무 중시 기본값.',
    weights: { value: 10, momentum: 20, quality: 30, volatility: 10, growth: 30 },
  },
  value: {
    key: 'value',
    name: '가치 강화',
    emoji: '💎',
    description: '그레이엄/버핏 스타일. 저PER·저PBR + ROE 필터.',
    weights: { value: 40, momentum: 5, quality: 35, volatility: 5, growth: 15 },
  },
  growth: {
    key: 'growth',
    name: '성장 강화',
    emoji: '🚀',
    description: '고성장 종목 위주. ROE + 매출·이익 성장률 + 모멘텀 중시.',
    weights: { value: 5, momentum: 20, quality: 35, volatility: 5, growth: 35 },
  },
  momentum: {
    key: 'momentum',
    name: '모멘텀',
    emoji: '📈',
    description: 'Jegadeesh-Titman 12-1 모멘텀 + 최소 퀄리티 필터.',
    weights: { value: 5, momentum: 45, quality: 25, volatility: 5, growth: 20 },
  },
  defensive: {
    key: 'defensive',
    name: '방어형',
    emoji: '🛡️',
    description: '하락장 방어. 퀄리티 + 저변동성 + 안정적 성장 중시.',
    weights: { value: 15, momentum: 5, quality: 40, volatility: 25, growth: 15 },
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
