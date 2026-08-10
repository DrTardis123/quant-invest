// 브라우저용 전략 프로파일
// src/strategies.js 와 동일한 정의. 클라이언트에서 재가중치 계산에 사용.

window.QUANT_STRATEGIES = {
  balanced: {
    key: 'balanced', name: '밸런스', emoji: '⚖️',
    description: '가치 35 + 모멘텀 20 + 퀄리티 20 + 저변동 15 + 성장 10. 기본값.',
    weights: { value: 35, momentum: 20, quality: 20, volatility: 15, growth: 10 },
  },
  value: {
    key: 'value', name: '가치 강화', emoji: '💎',
    description: '그레이엄/버핏 스타일. 저PER·저PBR + ROE 필터.',
    weights: { value: 50, momentum: 10, quality: 25, volatility: 5, growth: 10 },
  },
  growth: {
    key: 'growth', name: '성장 강화', emoji: '🚀',
    description: '고성장 종목 위주. 모멘텀 + 매출·EPS 성장률 중시.',
    weights: { value: 10, momentum: 30, quality: 20, volatility: 10, growth: 30 },
  },
  momentum: {
    key: 'momentum', name: '모멘텀', emoji: '📈',
    description: 'Jegadeesh-Titman 12-1 모멘텀 추종.',
    weights: { value: 15, momentum: 40, quality: 15, volatility: 10, growth: 20 },
  },
  defensive: {
    key: 'defensive', name: '방어형', emoji: '🛡️',
    description: '하락장 방어. 퀄리티 + 저변동성 중시.',
    weights: { value: 25, momentum: 5, quality: 30, volatility: 30, growth: 10 },
  },
};

// 등급 산정
window.QUANT_GRADE = function(score) {
  if (score === null || score === undefined || !Number.isFinite(score)) return { letter: '—', label: '—', color: 'secondary' };
  if (score >= 80) return { letter: 'A+', label: 'Strong Buy', color: 'success' };
  if (score >= 70) return { letter: 'A',  label: 'Buy',         color: 'success' };
  if (score >= 60) return { letter: 'B+', label: 'Accumulate',  color: 'primary' };
  if (score >= 50) return { letter: 'B',  label: 'Hold',        color: 'secondary' };
  if (score >= 40) return { letter: 'C',  label: 'Watch',       color: 'warning' };
  if (score >= 30) return { letter: 'D',  label: 'Avoid',       color: 'warning' };
  return { letter: 'F', label: 'Sell', color: 'danger' };
};
