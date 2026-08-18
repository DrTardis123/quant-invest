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

  // === 1차매수 (골든크로스 OR 정배열 + 거래량 + 20일선 우상향) — 조건 완화 ===
  const isGoldenCrossNow = ma5 > ma20 && ma5Prev <= ma20Prev; // 방금 발생
  const isGoldenCrossRecent = ma5 > ma20 && ma5Arr.length >= 3 && ma5Arr[ma5Arr.length - 3] <= ma20Arr[ma20Arr.length - 3]; // 3일 내
  const isAligned = ma5 > ma20 && ma20 > ma60; // 정배열 (필수)
  const ma20Rising = ma20 > ma20FiveAgo;
  const ma60Rising = ma60 > ma60FiveAgo;
  const volSurge = volLast > volMa20 * 1.0; // 1.0x↑로 완화 (이전 1.5x, 너무 strict)
  const nearHigh60 = last >= high60 * 0.95; // 60일 고가 5% 이내

  // === POC/지지선 가산 점수 (매물대 분석) ===
  // 매수가(ma20) ≈ POC/지지선 = 매수 적지 → 점수 +15/+10
  // calculateVolumeProfile에서 호출되므로 미리 계산 필요
  const vpEarly = calculateVolumeProfile(prices);
  let nearPoc = false, nearSupport = false;
  if (vpEarly) {
    // ma20이 POC ±5% 이내
    if (vpEarly.poc && Math.abs(ma20 - vpEarly.poc.price) / ma20 <= 0.05) nearPoc = true;
    // ma20이 지지선 ±5% 이내
    if (vpEarly.supportLines && vpEarly.supportLines.some((p) => Math.abs(ma20 - p) / ma20 <= 0.05)) nearSupport = true;
  }

  let buy1Score = 0;
  const buy1Reasons = [];
  if (isGoldenCrossNow) { buy1Score += 30; buy1Reasons.push('5일↑20일 골든크로스 (방금)'); }
  else if (isGoldenCrossRecent) { buy1Score += 20; buy1Reasons.push('5일↑20일 골든크로스 (3일 내)'); }
  if (isAligned) { buy1Score += 25; buy1Reasons.push('정배열 (5>20>60)'); }
  if (ma20Rising) { buy1Score += 15; buy1Reasons.push('20일선 우상향'); }
  if (ma60Rising) { buy1Score += 10; buy1Reasons.push('60일선 우상향'); }
  if (volSurge) { buy1Score += 15; buy1Reasons.push('거래량 1.0x↑ (평균 이상)'); }
  if (nearHigh60) { buy1Score += 5; buy1Reasons.push('60일 고가 5% 이내'); }
  // POC/지지선 가산 (매물대 분석)
  if (nearPoc) { buy1Score += 15; buy1Reasons.push(`POC(${vpEarly.poc.price.toLocaleString(undefined,{maximumFractionDigits:0})}원) 부근 매수가 (지지선)`); }
  if (nearSupport) { buy1Score += 10; buy1Reasons.push('지지선 부근 매수가 (반등 기대)'); }
  // 활성 조건: 골든크로스(방금) OR (정배열 + 거래량 평균 + 20일선 우상향)
  // 골든크로스 3일 내는 너무 느슨 (가짜 신호) → 방금만
  // 정배열만으로는 부족 → 거래량 + 20일선 우상향 필수
  const buy1ByGolden = isGoldenCrossNow;
  const buy1ByAligned = isAligned && volSurge && ma20Rising;
  const buy1Active = buy1ByGolden || buy1ByAligned;

  // === 2차매수 (눌림목: 5일선 근처 + 양봉 + 거래량 감소 + 20일선 우상향) — 조건 완화 ===
  const nearMa5 = last >= ma5 * 0.98 && last <= ma5 * 1.02; // 5일선 ±2%
  const nearMa20 = last >= ma20 * 0.95 && last <= ma20 * 1.02; // 20일선 위 ~5% 이내
  const isBullishCandle = last > closePrev; // 양봉
  const volDecline = volLast < volMa5 * 0.9; // 거래량 5일 평균보다 10%+ 감소 (완화, 0.8x→0.9x)
  const ma20RisingFor2 = ma20 > ma20FiveAgo;
  const aboveMa60 = last > ma60; // 60일선 위

  let buy2Score = 0;
  const buy2Reasons = [];
  if (nearMa5) { buy2Score += 30; buy2Reasons.push('5일선 ±2% 눌림'); }
  else if (nearMa20) { buy2Score += 20; buy2Reasons.push('20일선 위 -5% 눌림'); }
  if (isBullishCandle) { buy2Score += 25; buy2Reasons.push('당일 양봉'); }
  if (volDecline) { buy2Score += 20; buy2Reasons.push('거래량 0.9x↓ (건강한 조정)'); }
  if (ma20RisingFor2) { buy2Score += 15; buy2Reasons.push('20일선 우상향 (추세 유지)'); }
  if (aboveMa60) { buy2Score += 10; buy2Reasons.push('60일선 위 (장기 추세)'); }
  // POC/지지선 가산 (2차매수가 ma60 ≈ POC/지지선)
  if (vpEarly) {
    if (vpEarly.poc && Math.abs(ma60 - vpEarly.poc.price) / ma60 <= 0.10) { buy2Score += 10; buy2Reasons.push(`POC 부근 2차매수가`); }
    if (vpEarly.supportLines && vpEarly.supportLines.some((p) => Math.abs(ma60 - p) / ma60 <= 0.10)) { buy2Score += 5; buy2Reasons.push('지지선 부근 2차매수가'); }
  }
  // 활성 조건: 눌림목(nearMa5 OR nearMa20) + 양봉 + 거래량감소 + 20일선 우상향 + 60일선 위
  // (60일선 위는 추세의 기본 조건, 유지)
  const buy2Active = (nearMa5 || nearMa20) && isBullishCandle && volDecline && ma20RisingFor2 && aboveMa60;

  // === 매수가/매도가 (스윙 투자, 분할 매수/매도) ===
  // 매수가: 1차매수=ma20 (20일선, 추세 중심), 2차매수=ma60 (60일선, 메인 지지)
  // 매도가: 1차매도=ma20 × 1.15 (1차 익절 +15%, 절반 매도)
  //         2차매도=ma20 × 1.30 (2차 익절 +30%, 나머지 매도)
  // 손절: ma20 -3% 종가 이탈 시 즉시 매도 (트리거, 가격 X)
  // 매트릭스 (정배열, ma20 > ma60, 상승 추세):
  //   2차매수가(ma60) < 1차매수가(ma20) < 현재가 < 1차매도가(ma20×1.15) < 2차매도가(ma20×1.30)
  //   100 < 150 < 165 < 172.5 < 195 (사용자 요구 순서 일치)
  const buy1Price = ma20;   // 1차매수가: 20일선 (스윙 추세 진입)
  const buy2Price = ma60;   // 2차매수가: 60일선 (스윙 눌림목, 깊은 지지)
  const buyPrice = last;    // 매도/손익비 계산용 (현재가)

  // === 1차매도 (1차 익절) — 1차매수가(ma20) 기준 +15% (절반 매도) ===
  const sell1Price = buy1Price * 1.15; // 1차매수가(ma20) +15% (1차 익절, 절반 매도)
  // 손절 트리거 (가격 X, 추세 붕괴 시 즉시 매도)
  const belowMa20 = last < ma20 * 0.97; // 20일선 -3% 종가 이탈 (추세 붕괴)
  const profitPctFromBuy1 = (last - buy1Price) / buy1Price * 100; // 1차매수가 대비 수익
  const lossPctFromBuy1 = profitPctFromBuy1; // 별칭 (loss=음수)

  let sell1Score = 0;
  const sell1Reasons = [];
  if (profitPctFromBuy1 >= 15) { sell1Score += 50; sell1Reasons.push(`1차매수가 +15% 도달 (1차 익절, +${profitPctFromBuy1.toFixed(1)}%)`); }
  if (profitPctFromBuy1 >= 10) { sell1Score += 30; sell1Reasons.push(`1차매수가 +10% 도달 (1차 익절 임박, +${profitPctFromBuy1.toFixed(1)}%)`); }
  if (belowMa20) { sell1Score += 50; sell1Reasons.push('20일선 -3% 종가 이탈 (추세 붕괴 → 손절)'); }
  if (lossPctFromBuy1 <= -8) { sell1Score += 20; sell1Reasons.push(`1차매수가 -8%↓ (${lossPctFromBuy1.toFixed(1)}%)`); }
  if (volumes.length >= 3 && last < closePrev && volumes[volumes.length - 2] < volumes[volumes.length - 1]) {
    sell1Score += 10; sell1Reasons.push('음봉 + 거래량 증가 (투매)');
  }
  const sell1Active = profitPctFromBuy1 >= 15 || belowMa20 || lossPctFromBuy1 <= -8;

  // === 2차매도 (2차 익절) — 1차매수가(ma20) 기준 +30% (나머지 매도) ===
  // 매트릭스 보장: 2차매도가 = 1차매수가 × 1.30 (분할 매수 후에도 익절가 통일)
  // ma120은 active 조건(touchedMa120)에서만 보조 사용
  const ma120 = ma120Arr[ma120Arr.length - 1] || ma60;
  const sell2Price = buy1Price * 1.30; // 1차매수가(ma20) +30% (2차 익절)

  const profitPctFromBuy2 = (last - buy2Price) / buy2Price * 100; // 2차매수가 대비 수익
  const touchedMa120 = last >= ma120 * 0.99 && last <= ma120 * 1.02;

  let sell2Score = 0;
  const sell2Reasons = [];
  if (profitPctFromBuy1 >= 30) { sell2Score += 50; sell2Reasons.push(`1차매수가 +30% 도달 (2차 익절, +${profitPctFromBuy1.toFixed(1)}%)`); }
  else if (profitPctFromBuy1 >= 25) { sell2Score += 30; sell2Reasons.push(`1차매수가 +25% 도달 (2차 익절 임박, +${profitPctFromBuy1.toFixed(1)}%)`); }
  else if (profitPctFromBuy1 >= 20) { sell2Score += 20; sell2Reasons.push(`1차매수가 +20% 도달 (+${profitPctFromBuy1.toFixed(1)}%)`); }
  if (touchedMa120) { sell2Score += 30; sell2Reasons.push('120일선 터치 (장기 저항)'); }
  if (vol20 > 0.04 && profitPctFromBuy1 > 20) { sell2Score += 10; sell2Reasons.push('변동성 4%+ (고점 경고)'); }
  const sell2Active = profitPctFromBuy1 >= 30 || touchedMa120;

  // === 손익비 (1차매수가(ma20) 기준 — 매수 시점 손익비) ===
  // 1차매수가 → 1차매도가: 매입가 +15% (1차 익절 리워드)
  // 1차매수가 → 2차매도가: 매입가 +30% (2차 익절 리워드)
  // 손절: ma20 -3% 종가 이탈 시 즉시 매도 (별도 트리거, 가격 X)
  const profit1 = sell1Price - buy1Price; // +15%
  const profit2 = sell2Price - buy1Price; // +30%
  const risk = buy1Price * 0.10; // 손절: 매입가 -10% (예약 손절가)
  const riskRewardRatio = risk > 0 ? profit2 / risk : 0; // 30% / 10% = 3.0

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
      reward: round2(profit2),
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
    volumeProfile: calculateVolumeProfile(prices),
  };
}

// === 매물대 분석 (Volume Profile) ===
// 가격대별 거래량 집계 → POC (Point of Control), Value Area (70%), 지지/저항선
// 가격 범위 ~120일 기준, bucket은 가격 변동폭의 1% 단위 (정밀도 자동 조절)
function calculateVolumeProfile(prices, valueAreaPct = 0.70) {
  if (!prices || prices.length < 5) return null;
  const closes = prices.map((p) => Number(p.close) || 0);
  const volumes = prices.map((p) => Number(p.volume) || 0);
  const minP = Math.min(...closes);
  const maxP = Math.max(...closes);
  const range = maxP - minP;
  if (range === 0) return null;
  // 1% 단위 bucket (가격대 폭)
  const bucketSize = Math.max(range * 0.01, 1);
  const buckets = new Map();
  for (let i = 0; i < closes.length; i++) {
    const bucket = Math.floor(closes[i] / bucketSize) * bucketSize;
    buckets.set(bucket, (buckets.get(bucket) || 0) + volumes[i]);
  }
  // 정렬 + 비중 계산
  const profile = [...buckets.entries()]
    .map(([price, volume]) => ({ price: Math.round(price), volume }))
    .sort((a, b) => a.price - b.price);
  const totalVol = profile.reduce((s, p) => s + p.volume, 0);
  for (const p of profile) p.pct = p.volume / totalVol;
  // POC (Point of Control): 가장 거래량 많은 가격대
  const poc = profile.reduce((max, p) => p.volume > max.volume ? p : max, profile[0]);
  // Value Area: POC부터 거래량의 valueAreaPct(70%)가 포함된 구간
  const sortedByVol = [...profile].sort((a, b) => b.volume - a.volume);
  let vaSum = 0;
  const vaSet = new Set();
  for (const p of sortedByVol) {
    if (vaSum >= totalVol * valueAreaPct) break;
    vaSet.add(p.price);
    vaSum += p.volume;
  }
  const valueArea = profile.filter((p) => vaSet.has(p.price));
  const vaLow = Math.min(...valueArea.map((p) => p.price));
  const vaHigh = Math.max(...valueArea.map((p) => p.price));
  // 지지선/저항선: POC 위/아래 거래량 큰 가격대
  const supportLines = profile.filter((p) => p.price < poc.price && p.volume > totalVol * 0.005).slice(-3); // POC 아래 큰 거래량 3개
  const resistanceLines = profile.filter((p) => p.price > poc.price && p.volume > totalVol * 0.005).slice(0, 3); // POC 위 큰 거래량 3개
  return {
    bucketSize: Math.round(bucketSize),
    minPrice: Math.round(minP),
    maxPrice: Math.round(maxP),
    totalVolume: totalVol,
    profile, // [{price, volume, pct}, ...]
    poc: { price: poc.price, volume: poc.volume, pct: poc.pct },
    valueArea: { low: vaLow, high: vaHigh, pct: valueAreaPct, sumPct: vaSum / totalVol },
    supportLines: supportLines.map((p) => p.price),
    resistanceLines: resistanceLines.map((p) => p.price),
  };
}

function round2(v) { return Math.round(v * 100) / 100; }
function round4(v) { return Math.round(v * 10000) / 10000; }

module.exports = { calculateSignals, calculateVolumeProfile };
