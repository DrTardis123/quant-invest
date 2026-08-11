'use strict';

// 5가지 전략 프로파일 (7팩터)
// 가중치 합 = 100
// 한국 시장 멀티팩터 실무 가중치 기반 (삼성증권·AQR·quantgt.io 참고):
// - 재무제표(퀄리티+성장) 50%+ (삼성증권 54%, AQR 퀄리티 25%)
// - 가치(PER/PBR)는 2020년대 약세기 → 8-12%로 하향
// - 모멘텀은 꾸준한 효과 (22-25%)
// - 저변동성은 방어 (8-10%)
// - 유동성(거래대금): 한국 외인/기관 매매 영향 반영 (5-8%)
// - 수급(외인/기관): 단기 순매수 (5-8%)
const STRATEGIES = {
  balanced: {
    key: 'balanced',
    name: '밸런스',
    emoji: '⚖️',
    description: '재무중시 기본. 가치 8 + 모멘텀 22 + 퀄리티 27 + 저변동 8 + 성장 20 + 유동 8 + 수급 7.',
    weights: { value: 8, momentum: 22, quality: 27, volatility: 8, growth: 20, liquidity: 8, supply: 7 },
  },
  value: {
    key: 'value',
    name: '가치 강화',
    emoji: '💎',
    description: '그레이엄/버핏 스타일. 가치 35 + 퀄리티 30 + 유동 10 + 성장 15.',
    weights: { value: 35, momentum: 5, quality: 30, volatility: 5, growth: 15, liquidity: 5, supply: 5 },
  },
  growth: {
    key: 'growth',
    name: '성장 강화',
    emoji: '🚀',
    description: '고성장 종목. 성장 35 + 퀄리티 25 + 모멘텀 20 + 수급 10.',
    weights: { value: 5, momentum: 20, quality: 25, volatility: 5, growth: 35, liquidity: 5, supply: 5 },
  },
  momentum: {
    key: 'momentum',
    name: '모멘텀',
    emoji: '📈',
    description: '12-1 모멘텀 + 수급 추종. 모멘텀 40 + 수급 15 + 퀄리티 20 + 성장 15.',
    weights: { value: 5, momentum: 40, quality: 20, volatility: 5, growth: 15, liquidity: 5, supply: 10 },
  },
  defensive: {
    key: 'defensive',
    name: '방어형',
    emoji: '🛡️',
    description: '하락장 방어. 퀄리티 35 + 저변동 25 + 성장 15 + 가치 15.',
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
