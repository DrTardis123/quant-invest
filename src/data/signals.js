'use strict';
// 1차/2차 매수·매도 신호 계산 (웹서칭 기반 정확 기준)
// 참고: 키움증권 검색식, 추세추종 매매법, 윌리엄 오닐 CANSLIM, 터틀 트레이딩
//
// 1차매수 (1st Buy) - 추세 진입
//   - 5일선이 20일선 위로 골든크로스 (방금 발생)
//   - 정배열: 5일선 > 20일선 > 60일선
//   - 20일선 우상향 (기울기 > 0)
//   - 거래량 > 20일 평균 × 1.5
//   - 60일 고가 근처 (전고점 돌파 직전)
//
// 2차매수 (2nd Buy / Add) - 눌림목 매수
//   - 5일선 또는 20일선 근처 눌림
//   - 양봉 전환 (당일 close > 전일 close)
//   - 거래량 ≤ 5일 평균 × 0.8 (조절 중)
//   - 20일선 우상향 (추세 유지)
//
// 1차매도 (1st Sell) - 손절/리스크 관리
//   - 매입가 대비 -7% (윌리엄 오닐 표준)
//   - 5일선 종가 이탈 (장대음봉)
//   - 매수 신호 무효화 시 즉시 매도
//
// 2차매도 (2nd Sell) - 익절
//   - 매입가 +3R = +21% (손익비 3:1)
//   - 60일선 터치 (과열 신호)
//   - 5일선 데드크로스
//
// 손익비: 3:1 (승률 30% 가정 +1.4R/매매)

function avg(arr, n) {
  if (arr.length < n) return [];
  const out = [];
  for (let i = n - 1; i < arr.length; i++) {
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += arr[j];
    out.push(s / n);
  }
  return out;
}

function calculateSignals(prices, technical) {
  if (!prices || prices.length < 60) return null;
  const closes = prices.map((p) => Number(p.close) || 0);
  const volumes = prices.map((p) => Number(p.volume) || 0);
  const last = closes[closes.length - 1];
  const ma5Arr = avg(closes, 5);
  const ma20Arr = avg(closes, 20);
  const ma60Arr = avg(closes, 60);
  const ma120Arr = avg(closes, 120);
  const volMa5Arr = avg(volumes, 5);
  const volMa20Arr = avg(volumes, 20);

  if (ma5Arr.length === 0 || ma20Arr.length === 0 || ma60Arr.length === 0) return null;

  const ma5 = ma5Arr[ma5Arr.length - 1];
  const ma20 = ma20Arr[ma20Arr.length - 1];
  const ma60 = ma60Arr[ma60Arr.length - 1];
  const ma5Prev = ma5Arr[ma5Arr.length - 2];
  const ma20Prev = ma20Arr[ma20Arr.length - 2];
  const ma20FiveAgo = ma20Arr.length >= 5 ? ma20Arr[ma20Arr.length - 5] : ma20;
  const ma60FiveAgo = ma60Arr.length >= 5 ? ma60Arr[ma60Arr.length - 5] : ma60;
  const volMa5 = volMa5Arr[volMa5Arr.length - 1];
  const volMa20 = volMa20Arr[volMa20Arr.length - 1];
  const volLast = volumes[volumes.length - 1];
  const closePrev = closes[closes.length - 2];

  // 60일 고가
  const last60 = closes.slice(-60);
  const high60 = Math.max(...last60);
  // 20일 변동성 (ATR-like)
  const rets = [];
  for (let i = closes.length - 20; i < closes.length; i++) {
    if (i < 1) continue;
    const c0 = closes[i - 1];
    const c1 = closes[i];
    if (c0 > 0 && c1 > 0) rets.push((c1 - c0) / c0);
  }
  const vol20 = rets.length > 0 ? Math.sqrt(rets.reduce((a, b) => a + b * b, 0) / rets.length) : 0;

  // === 1차매수 (골든크로스 + 정배열 + 거래량 + 20일선 우상향) ===
  const isGoldenCrossNow = ma5 > ma20 && ma5Prev <= ma20Prev; // 방금 발생
  const isGoldenCrossRecent = ma5 > ma20 && ma5Arr.length >= 3 && ma5Arr[ma5Arr.length - 3] <= ma20Arr[ma20Arr.length - 3]; // 3일 내
  const isAligned = ma5 > ma20 && ma20 > ma60;
  const ma20Rising = ma20 > ma20FiveAgo;
  const ma60Rising = ma60 > ma60FiveAgo;
  const volSurge = volLast > volMa20 * 1.5;
  const nearHigh60 = last >= high60 * 0.95; // 60일 고가 5% 이내

  let buy1Score = 0;
  const buy1Reasons = [];
  if (isGoldenCrossNow) { buy1Score += 30; buy1Reasons.push('5일↑20일 골든크로스 (방금)'); }
  else if (isGoldenCrossRecent) { buy1Score += 20; buy1Reasons.push('5일↑20일 골든크로스 (3일 내)'); }
  if (isAligned) { buy1Score += 25; buy1Reasons.push('정배열 (5>20>60)'); }
  if (ma20Rising) { buy1Score += 15; buy1Reasons.push('20일선 우상향'); }
  if (ma60Rising) { buy1Score += 10; buy1Reasons.push('60일선 우상향'); }
  if (volSurge) { buy1Score += 15; buy1Reasons.push('거래량 1.5x↑'); }
  if (nearHigh60) { buy1Score += 5; buy1Reasons.push('60일 고가 5% 이내'); }
  const buy1Active = (isGoldenCrossNow || isGoldenCrossRecent) && isAligned && ma20Rising && volSurge;

  // === 2차매수 (눌림목: 5일선 근처 + 양봉 + 거래량 감소 + 20일선 우상향) ===
  const nearMa5 = last >= ma5 * 0.98 && last <= ma5 * 1.02; // 5일선 ±2%
  const nearMa20 = last >= ma20 * 0.95 && last <= ma20 * 1.02; // 20일선 위 ~5% 이내
  const isBullishCandle = last > closePrev; // 양봉
  const volDecline = volLast < volMa5 * 0.8; // 거래량 5일 평균보다 20%+ 감소
  const ma20RisingFor2 = ma20 > ma20FiveAgo;
  const aboveMa60 = last > ma60; // 60일선 위

  let buy2Score = 0;
  const buy2Reasons = [];
  if (nearMa5) { buy2Score += 30; buy2Reasons.push('5일선 ±2% 눌림'); }
  else if (nearMa20) { buy2Score += 20; buy2Reasons.push('20일선 위 -5% 눌림'); }
  if (isBullishCandle) { buy2Score += 25; buy2Reasons.push('당일 양봉'); }
  if (volDecline) { buy2Score += 20; buy2Reasons.push('거래량 0.8x↓ (건강한 조정)'); }
  if (ma20RisingFor2) { buy2Score += 15; buy2Reasons.push('20일선 우상향 (추세 유지)'); }
  if (aboveMa60) { buy2Score += 10; buy2Reasons.push('60일선 위 (장기 추세)'); }
  const buy2Active = (nearMa5 || nearMa20) && isBullishCandle && volDecline && ma20RisingFor2 && aboveMa60;

  // === 매수가 가정 ===
  // 1차매수 = ma5 (5일선 = 추세 시작 가격, 골든크로스 후 매수)
  // 2차매수 = ma20 (20일선 = 단기 눌림목 매수)
  // 의미: 1차매수(5일선, 추세 진입) → 눌림 발생 → 2차매수(20일선, 더 낮은 가격에서 추가 매수)
  // 정배열 시 ma5 > ma20 이므로 1차매수 가격이 항상 더 비쌈 (분할 매수 효과)
  const buy1Price = ma5;
  const buy2Price = ma20;
  const buyPrice = last; // 매도/손익비 계산용 (현재가 기준)

  // === 1차매도 (손절: -7% OR 5일선 종가 이탈) ===
  const stopLossPct = -7; // -7% (오닐)
  const sell1LossPrice = buyPrice * (1 + stopLossPct / 100);
  const sell1Ma5Price = ma5 * 0.98; // 5일선 2% 이탈
  const sell1Price = Math.max(sell1LossPrice, sell1Ma5Price); // 더 타이트한 손절
  const belowMa5 = last < ma5 * 0.98;
  const lossPctNow = (last - buyPrice) / buyPrice * 100;

  let sell1Score = 0;
  const sell1Reasons = [];
  if (belowMa5) { sell1Score += 50; sell1Reasons.push('5일선 종가 이탈 (장대음봉)'); }
  if (lossPctNow <= -3) { sell1Score += 20; sell1Reasons.push(`현재 -3%↓ (${lossPctNow.toFixed(1)}%)`); }
  if (lossPctNow <= -5) { sell1Score += 20; sell1Reasons.push(`현재 -5%↓ (${lossPctNow.toFixed(1)}%)`); }
  if (volumes.length >= 3 && last < closePrev && volumes[volumes.length - 2] < volumes[volumes.length - 1]) {
    sell1Score += 10; sell1Reasons.push('음봉 + 거래량 증가 (투매)');
  }
  const sell1Active = belowMa5 || lossPctNow <= -5;

  // === 2차매도 (익절: +3R +21% OR 60일선 터치) ===
  const takeProfit1Price = buyPrice * 1.21; // +21% (3R)
  const takeProfit2Price = buyPrice * 1.08; // +8% (단기)
  const sell2Price60 = ma60 * 0.99; // 60일선 -1% 터치
  let sell2Price = takeProfit1Price;
  if (last >= takeProfit1Price * 0.95) sell2Price = takeProfit1Price; // +21% 근처
  else if (last >= takeProfit2Price) sell2Price = takeProfit2Price; // +8% 이상
  else if (last >= sell2Price60) sell2Price = sell2Price60;

  const profitPctNow = (last - buyPrice) / buyPrice * 100;
  const touchedMa60 = last >= ma60 * 0.99 && last <= ma60 * 1.02;

  let sell2Score = 0;
  const sell2Reasons = [];
  if (profitPctNow >= 21) { sell2Score += 50; sell2Reasons.push(`+21% 도달 (3R, ${profitPctNow.toFixed(1)}%)`); }
  else if (profitPctNow >= 8) { sell2Score += 30; sell2Reasons.push(`+8% 도달 (단기, ${profitPctNow.toFixed(1)}%)`); }
  if (touchedMa60) { sell2Score += 30; sell2Reasons.push('60일선 터치 (과열)'); }
  if (vol20 > 0.03 && profitPctNow > 10) { sell2Score += 10; sell2Reasons.push('변동성 3%+ (고점 경고)'); }
  const sell2Active = profitPctNow >= 8 || touchedMa60;

  // === 손익비 (현재가 → 손절 / 익절) ===
  const risk = buyPrice - sell1Price;
  const reward = sell2Price - buyPrice;
  const riskRewardRatio = risk > 0 ? reward / risk : 0;

  // === 포지션 사이징 (R 기반) ===
  // R = 1% 계좌, 매매당 1R = -7% → 1매매당 14% (R/0.07), 10개 분산 시 1종목 14%/10 = 1.4%
  // 분할 매수 3회: 1차 50% + 2차 30% + 3차 20%
  const positionSizePerTrade = 14; // 1매매당 최대 14%
  const split1 = 50; // 1차매수 비중
  const split2 = 30; // 2차매수 비중
  const split3 = 20; // 3차매수 비중 (향후 추가)

  return {
    asOf: new Date().toISOString(),
    currentPrice: last,
    buyPrice,
    ma: { ma5, ma20, ma60, ma120: ma120Arr[ma120Arr.length - 1] || null },
    buy1: {
      active: buy1Active,
      score: Math.min(100, buy1Score),
      price: Math.round(buy1Price),
      reasons: buy1Reasons,
      action: buy1Active ? 'BUY' : 'WAIT',
      description: '5일↑20일 골든크로스 + 정배열 (5>20>60) + 20일선 우상향 + 거래량 1.5x↑',
    },
    buy2: {
      active: buy2Active,
      score: Math.min(100, buy2Score),
      price: Math.round(buy2Price),
      reasons: buy2Reasons,
      action: buy2Active ? 'BUY' : 'WAIT',
      description: '5일선/20일선 눌림 + 양봉 + 거래량 0.8x↓ + 20일선 우상향 + 60일선 위',
    },
    sell1: {
      active: sell1Active,
      score: Math.min(100, sell1Score),
      price: round2(sell1Price),
      lossPct: round2((sell1Price - buyPrice) / buyPrice * 100),
      reasons: sell1Reasons,
      action: sell1Active ? 'SELL' : 'HOLD',
      description: '매입가 -7% (오닐) OR 5일선 종가 -2% 이탈',
    },
    sell2: {
      active: sell2Active,
      score: Math.min(100, sell2Score),
      price: round2(sell2Price),
      profitPct: round2((sell2Price - buyPrice) / buyPrice * 100),
      reasons: sell2Reasons,
      action: sell2Active ? 'SELL' : 'HOLD',
      description: '+21% (3R) OR +8% (단기) OR 60일선 터치',
    },
    riskReward: {
      ratio: round2(riskRewardRatio),
      risk: round2(risk),
      reward: round2(reward),
      stopLoss: round2(sell1Price),
      takeProfit: round2(sell2Price),
    },
    positionSizing: {
      perTradePct: positionSizePerTrade,
      split: { first: split1, second: split2, third: split3 },
      note: 'R=1% 가정, 1매매 -7% 손실 시 1R (14%), 10종목 분산 시 1.4%',
    },
    context: {
      isAligned,
      ma20Rising,
      ma60Rising,
      volSurge,
      nearHigh60,
      vol20: round4(vol20),
    },
  };
}

function round2(v) { return Math.round(v * 100) / 100; }
function round4(v) { return Math.round(v * 10000) / 10000; }

module.exports = { calculateSignals };
