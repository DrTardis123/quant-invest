// 브라우저용 전략 프로파일
// src/strategies.js 와 동일한 정의. 클라이언트에서 재가중치 계산에 사용.
// 2026-08-14 업데이트: OOS 회귀분석 1개월 out-of-sample 기반 가치 가중치 채택
// - 가치(50/10/15/5/10/5/5) Sharpe 3.10, Total +56.92% (KOSPI -19.62%)

window.QUANT_STRATEGIES = {
  balanced: {
    key: 'balanced', name: '밸런스', emoji: '⚖️',
    description: 'OOS 가치+균형. 가치 20 + 모멘텀 20 + 퀄리티 25 + 저변동 10 + 성장 15 + 유동 5 + 수급 5.',
    weights: { value: 20, momentum: 20, quality: 25, volatility: 10, growth: 15, liquidity: 5, supply: 5 },
  },
  value: {
    key: 'value', name: '가치 강화', emoji: '💎',
    description: 'OOS 1개월 Sharpe 3.10 / +56.92%. 가치 50 + 퀄리티 15 + 성장 10 + 모멘텀 10.',
    weights: { value: 50, momentum: 10, quality: 15, volatility: 5, growth: 10, liquidity: 5, supply: 5 },
  },
  growth: {
    key: 'growth', name: '성장 강화', emoji: '🚀',
    description: '고성장 종목. 성장 35 + 퀄리티 25 + 모멘텀 20 + 유동 5 + 수급 5.',
    weights: { value: 5, momentum: 20, quality: 25, volatility: 5, growth: 35, liquidity: 5, supply: 5 },
  },
  momentum: {
    key: 'momentum', name: '모멘텀', emoji: '📈',
    description: '12-1 모멘텀 + 수급 추종. 모멘텀 40 + 퀄리티 20 + 성장 15 + 수급 10.',
    weights: { value: 5, momentum: 40, quality: 20, volatility: 5, growth: 15, liquidity: 5, supply: 10 },
  },
  defensive: {
    key: 'defensive', name: '방어형', emoji: '🛡️',
    description: '하락장 방어. 퀄리티 35 + 저변동 25 + 성장 15 + 가치 15 + 유동 5.',
    weights: { value: 15, momentum: 5, quality: 35, volatility: 25, growth: 15, liquidity: 5, supply: 0 },
  },
};

window.QUANT_GRADE = function (score) {
  if (score >= 85) return { letter: 'A+', label: 'Strong Buy', color: 'success' };
  if (score >= 75) return { letter: 'A', label: 'Buy', color: 'success' };
  if (score >= 65) return { letter: 'B+', label: 'Accumulate', color: 'primary' };
  if (score >= 55) return { letter: 'B', label: 'Hold', color: 'secondary' };
  if (score >= 45) return { letter: 'C', label: 'Watch', color: 'warning' };
  if (score >= 30) return { letter: 'D', label: 'Avoid', color: 'danger' };
  return { letter: 'F', label: 'Sell', color: 'dark' };
};
