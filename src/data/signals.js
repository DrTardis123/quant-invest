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

  // === 추가 기술 지표 (ATR/볼린저/52주/RSI/MACD/피보나치/이격도) ===
  // ATR(14): 변동성 → 손절폭 조정
  // 볼린저밴드(20, 2σ): 상단 = 저항, 하단 = 지지
  // 52주 신고가: 강한 저항, 52주 신저가: 최후 지지
  // RSI(14): 30↓ 과매도, 70↑ 과매수, 다이버전스 = 추세 전환
  // MACD(12,26,9): Signal선 교차 + 0선 위 = 모멘텀
  // 피보나치 되돌림: 23.6%, 38.2%, 61.8% = 지지/저항
  // 이격도: 현재가 vs MA 괴리율 = 과매수/과매도
  const atr = calculateATR(prices, 14);
  const bb = calculateBollingerBands(prices, 20, 2);
  const year52 = calculate52Week(prices);
  const rsi = calculateRSI(prices, 14);
  const macd = calculateMACD(prices, 12, 26, 9);
  const fib = calculateFibonacci(prices, 60); // 60일 고점/저점 기준
  // 데이터 부족 시 안전한 fallback
  const atrValue = atr || 0;
  const atrPct = atrValue > 0 && last > 0 ? (atrValue / last * 100) : 0; // ATR/현재가 %
  const bbUpper = bb ? bb.upper : last * 1.2;
  const bbLower = bb ? bb.lower : last * 0.8;
  const high52 = year52 ? year52.high : last * 1.5; // 52주고가
  const low52 = year52 ? year52.low : last * 0.5; // 52주신저가
  const rsiValue = rsi !== null ? rsi : 50; // RSI (0~100)
  const macdValue = macd ? macd.macd : 0;
  const macdSignal = macd ? macd.signal : 0;
  const macdHist = macd ? macd.histogram : 0;
  const macdCrossUp = macd && macd.prevMacd !== undefined && macd.prevMacd <= macd.prevSignal && macd.macd > macd.signal; // 방금 골든크로스
  const macdCrossDown = macd && macd.prevMacd !== undefined && macd.prevMacd >= macd.prevSignal && macd.macd < macd.signal; // 방금 데드크로스
  const macdAboveZero = macd && macd.macd > 0; // 0선 위
  const macdBelowZero = macd && macd.macd < 0; // 0선 아래
  // 이격도: (현재가 - MA) / MA * 100
  const disparityMa20 = ma20 > 0 ? ((last - ma20) / ma20) * 100 : 0; // +면 위, -면 아래
  const disparityMa60 = ma60 > 0 ? ((last - ma60) / ma60) * 100 : 0;
  const isOverheated = disparityMa20 > 10; // 20일선 +10% 이상 = 과열
  const isOversold = disparityMa20 < -10; // 20일선 -10% 이하 = 침체
  // RSI 과매수/과매도
  const rsiOverbought = rsiValue >= 70;
  const rsiOversold = rsiValue <= 30;
  const rsiRecovering = rsi !== null && rsi < 35 && last > closePrev; // 35↓에서 양봉 = 반등 시작

  // === 매수가/매도가 (스윙 투자, 분할 매수/매도, 5개 요소 종합) ===
  // 매수가: 1차매수=ma20 (20일선, 추세 중심), 2차매수=ma60 (60일선, 메인 지지)
  //   보조: BB하단/52주신저가 (지지선 우선)
  // 매도가: 1차매도 = min(이평선+15%, BB상단, 52주고가-3%) 중 가장 가까운 저항선
  //         2차매도 = min(이평선+30%, 52주고가-1%) 중 가장 가까운 저항선
  // 손절: max(이평선-10%, 매입가-2×ATR) — ATR 기반 동적 손절
  // 매트릭스 (정배열): 2차매수 < 1차매수 < 현재가 < 1차매도 < 2차매도
  const buy1Price = ma20;   // 1차매수가: 20일선 (스윙 추세 진입)
  const buy2Price = ma60;   // 2차매수가: 60일선 (스윙 눌림목, 깊은 지지)
  const buyPrice = last;    // 매도/손익비 계산용 (현재가)

  // === 1차매도 (1차 익절) — 5개 요소 종합: ma20+15% / BB상단 / 52주고가-3% / 피보나치 38.2% / 피보나치 61.8% 중 보수적 ===
  // 5개 저항선 후보 중 가장 가까운(최소) 값 → 보수적 매도가
  // 단, 매수가(ma20)보다 작아지면 안 됨 → 최소 +10% 수익 보장
  const sell1Cand1 = buy1Price * 1.15;        // 1차매수가(ma20) +15% (1차 익절)
  const sell1Cand2 = bbUpper;                  // 볼린저밴드 상단 (저항)
  const sell1Cand3 = high52 * 0.97;           // 52주고가 -3% (강한 저항)
  const sell1Cand4 = fib ? fib.level_382 : last * 1.20; // 피보나치 38.2% 되돌림 (저항)
  const sell1Cand5 = fib ? fib.level_618 : last * 1.25; // 피보나치 61.8% 되돌림 (저항)
  const sell1Raw = Math.min(sell1Cand1, sell1Cand2, sell1Cand3, sell1Cand4, sell1Cand5);
  // 보정: 매수가보다 낮으면 매수가+10% (손실 방지)
  const sell1Price = Math.max(sell1Raw, buy1Price * 1.10);

  // 손절 트리거 (가격 X, 추세 붕괴 또는 ATR 손절)
  const belowMa20 = last < ma20 * 0.97; // 20일선 -3% 종가 이탈 (추세 붕괴)
  const profitPctFromBuy1 = (last - buy1Price) / buy1Price * 100;
  const lossPctFromBuy1 = profitPctFromBuy1;

  let sell1Score = 0;
  const sell1Reasons = [];
  if (profitPctFromBuy1 >= 15) { sell1Score += 50; sell1Reasons.push(`1차매수가 +15% 도달 (1차 익절, +${profitPctFromBuy1.toFixed(1)}%)`); }
  if (profitPctFromBuy1 >= 10) { sell1Score += 30; sell1Reasons.push(`1차매수가 +10% 도달 (1차 익절 임박, +${profitPctFromBuy1.toFixed(1)}%)`); }
  if (sell1Price === sell1Cand2) { sell1Score += 10; sell1Reasons.push(`BB상단(${Math.round(bbUpper).toLocaleString()}원) = 1차 매도 적지`); }
  if (sell1Price === sell1Cand3) { sell1Score += 10; sell1Reasons.push(`52주고가 -3% (${Math.round(high52 * 0.97).toLocaleString()}원) = 강한 저항`); }
  if (fib && sell1Price === sell1Cand4) { sell1Score += 10; sell1Reasons.push(`피보나치 38.2% (${Math.round(sell1Cand4).toLocaleString()}원) = 저항`); }
  if (fib && sell1Price === sell1Cand5) { sell1Score += 10; sell1Reasons.push(`피보나치 61.8% (${Math.round(sell1Cand5).toLocaleString()}원) = 강한 저항`); }
  if (belowMa20) { sell1Score += 50; sell1Reasons.push('20일선 -3% 종가 이탈 (추세 붕괴 → 손절)'); }
  if (lossPctFromBuy1 <= -8) { sell1Score += 20; sell1Reasons.push(`1차매수가 -8%↓ (${lossPctFromBuy1.toFixed(1)}%)`); }
  if (volumes.length >= 3 && last < closePrev && volumes[volumes.length - 2] < volumes[volumes.length - 1]) {
    sell1Score += 10; sell1Reasons.push('음봉 + 거래량 증가 (투매)');
  }
  // RSI/MACD/이격도 가산 (MA·매물대 외 보조 매도 신호)
  if (rsiOverbought) { sell1Score += 15; sell1Reasons.push(`RSI ${rsiValue.toFixed(1)} (과매수 ≥70)`); }
  if (macdCrossDown) { sell1Score += 15; sell1Reasons.push('MACD 데드크로스 (모멘텀 약화)'); }
  if (isOverheated) { sell1Score += 10; sell1Reasons.push(`이격도 +${disparityMa20.toFixed(1)}% (20일선 과열)`); }
  const sell1Active = profitPctFromBuy1 >= 15 || belowMa20 || lossPctFromBuy1 <= -8 || rsiOverbought || macdCrossDown;

  // === 2차매도 (2차 익절) — 4개 요소 종합: ma20+30% / 52주고가-1% / 피보나치 23.6% / 120일선 터치 중 보수적 ===
  const ma120 = ma120Arr[ma120Arr.length - 1] || ma60;
  const sell2Cand1 = buy1Price * 1.30;        // 1차매수가(ma20) +30% (2차 익절)
  const sell2Cand2 = high52 * 0.99;           // 52주고가 -1% (강한 저항)
  const sell2Cand3 = fib ? fib.level_236 : last * 1.35; // 피보나치 23.6% (저항)
  const sell2Raw = Math.min(sell2Cand1, sell2Cand2, sell2Cand3);
  // 보정: 매수가보다 낮으면 매수가+20% (2차 익절은 더 큰 수익 기대)
  const sell2Price = Math.max(sell2Raw, buy1Price * 1.20);

  const profitPctFromBuy2 = (last - buy2Price) / buy2Price * 100;
  const touchedMa120 = last >= ma120 * 0.99 && last <= ma120 * 1.02;

  let sell2Score = 0;
  const sell2Reasons = [];
  if (profitPctFromBuy1 >= 30) { sell2Score += 50; sell2Reasons.push(`1차매수가 +30% 도달 (2차 익절, +${profitPctFromBuy1.toFixed(1)}%)`); }
  else if (profitPctFromBuy1 >= 25) { sell2Score += 30; sell2Reasons.push(`1차매수가 +25% 도달 (2차 익절 임박, +${profitPctFromBuy1.toFixed(1)}%)`); }
  else if (profitPctFromBuy1 >= 20) { sell2Score += 20; sell2Reasons.push(`1차매수가 +20% 도달 (+${profitPctFromBuy1.toFixed(1)}%)`); }
  if (sell2Price === sell2Cand2) { sell2Score += 10; sell2Reasons.push(`52주고가 -1% (${Math.round(high52 * 0.99).toLocaleString()}원) = 강한 저항`); }
  if (fib && sell2Price === sell2Cand3) { sell2Score += 10; sell2Reasons.push(`피보나치 23.6% (${Math.round(sell2Cand3).toLocaleString()}원) = 강한 저항`); }
  if (touchedMa120) { sell2Score += 30; sell2Reasons.push('120일선 터치 (장기 저항)'); }
  if (vol20 > 0.04 && profitPctFromBuy1 > 20) { sell2Score += 10; sell2Reasons.push('변동성 4%+ (고점 경고)'); }
  // RSI/MACD 가산 (극단 과매수/모멘텀 다이버전스)
  if (rsiValue >= 80) { sell2Score += 15; sell2Reasons.push(`RSI ${rsiValue.toFixed(1)} (극단 과매수 ≥80)`); }
  if (macdBelowZero && profitPctFromBuy1 > 20) { sell2Score += 10; sell2Reasons.push('MACD 0선 하향 (모멘텀 소멸)'); }
  const sell2Active = profitPctFromBuy1 >= 30 || touchedMa120 || rsiValue >= 80;

  // === 손절가 (ATR 기반 동적 손절, 별도 필드) ===
  // 기본 손절: 매입가 -10%
  // 변동성 큰 종목: 매입가 -2×ATR (노이즈 견딤)
  // 보수적: max(매입가 - 10%, 매입가 - 2×ATR) = 둘 중 큰 값 (손실 적은 값)
  const stopLossPct = -10; // 기본
  const stopLossPrice = buy1Price * (1 + stopLossPct / 100); // 165 * 0.9 = 148.5
  const stopLossByAtr = buy1Price - 2 * atrValue; // 165 - 2*5 = 155 (ATR=5일 때)
  const dynamicStopLoss = Math.max(stopLossPrice, stopLossByAtr); // 둘 중 큰 값 (더 위에 = 손실 적음)

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
    // === 보조 지표 (MA·매물대 외) — 웹서칭 기반 매트릭스 ===
    indicators: {
      rsi: {
        value: round2(rsiValue),
        overbought: rsiOverbought,
        oversold: rsiOversold,
        recovering: rsiRecovering,
      },
      macd: {
        macd: round4(macdValue),
        signal: round4(macdSignal),
        histogram: round4(macdHist),
        crossUp: macdCrossUp,
        crossDown: macdCrossDown,
        aboveZero: macdAboveZero,
        belowZero: macdBelowZero,
      },
      fibonacci: fib,
      disparity: {
        ma20: round2(disparityMa20),
        ma60: round2(disparityMa60),
        overheated: isOverheated,
        oversold: isOversold,
      },
    },
    // === 매트릭스 (5개 요소 종합 — UI 표시용) ===
    matrix: {
      buy1: {
        // 1차매수가 = ma20 (메인), 보조: BB하단, 52주신저가
        candidates: [
          { name: 'MA20', price: Math.round(ma20), selected: true },
          { name: 'BB하단', price: Math.round(bbLower), selected: false },
          { name: '52주신저', price: Math.round(low52), selected: false },
        ],
        final: Math.round(buy1Price),
      },
      buy2: {
        // 2차매수가 = ma60 (메인), 보조: BB하단, 52주신저, 피보나치 78.6%
        candidates: [
          { name: 'MA60', price: Math.round(ma60), selected: true },
          { name: 'BB하단', price: Math.round(bbLower), selected: false },
          { name: '52주신저', price: Math.round(low52), selected: false },
          ...(fib ? [{ name: '피보 78.6%', price: Math.round(fib.level_786), selected: false }] : []),
        ],
        final: Math.round(buy2Price),
      },
      sell1: {
        // 1차매도 = 5개 요소 중 보수적(최소), 단 매수가+10% 이상 보장
        // selected: 보정 전 raw 최소값 표시 → 어떤 저항선이 가장 가까운지
        // final: 보정 후 실제 매도가 (매수가+10% 이상)
        candidates: [
          { name: 'MA20+15%', price: Math.round(sell1Cand1), selected: sell1Raw === sell1Cand1 },
          { name: 'BB상단', price: Math.round(sell1Cand2), selected: sell1Raw === sell1Cand2 },
          { name: '52주고-3%', price: Math.round(sell1Cand3), selected: sell1Raw === sell1Cand3 },
          ...(fib ? [{ name: '피보 38.2%', price: Math.round(sell1Cand4), selected: sell1Raw === sell1Cand4 }] : []),
          ...(fib ? [{ name: '피보 61.8%', price: Math.round(sell1Cand5), selected: sell1Raw === sell1Cand5 }] : []),
        ],
        final: round2(sell1Price),
        adjusted: sell1Raw < buy1Price * 1.10, // 보정 여부
      },
      sell2: {
        // 2차매도 = 3개 요소 중 보수적(최소), 단 매수가+20% 이상 보장
        candidates: [
          { name: 'MA20+30%', price: Math.round(sell2Cand1), selected: sell2Raw === sell2Cand1 },
          { name: '52주고-1%', price: Math.round(sell2Cand2), selected: sell2Raw === sell2Cand2 },
          ...(fib ? [{ name: '피보 23.6%', price: Math.round(sell2Cand3), selected: sell2Raw === sell2Cand3 }] : []),
        ],
        final: round2(sell2Price),
        adjusted: sell2Raw < buy1Price * 1.20,
      },
      stopLoss: {
        // 손절 = max(매입가-10%, 매입가-2×ATR) = 둘 중 큰 값 (손실 적은 값)
        candidates: [
          { name: 'MA20-10%', price: round2(stopLossPrice), selected: dynamicStopLoss === stopLossPrice },
          { name: 'MA20-2×ATR', price: round2(stopLossByAtr), selected: dynamicStopLoss === stopLossByAtr },
        ],
        final: round2(dynamicStopLoss),
        trigger: 'ma20-3% 종가 이탈 OR 매도가 도달',
      },
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

// === ATR (Average True Range, 14기간) ===
// 변동성 측정 → 손절폭 동적 조정
// TR = max(고가-저가, |고가-전일종가|, |저가-전일종가|)
// ATR = TR의 14일 단순평균
function calculateATR(prices, period = 14) {
  if (!prices || prices.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < prices.length; i++) {
    const high = Number(prices[i].high) || 0;
    const low = Number(prices[i].low) || 0;
    const closePrev = Number(prices[i - 1].close) || 0;
    const tr = Math.max(high - low, Math.abs(high - closePrev), Math.abs(low - closePrev));
    trs.push(tr);
  }
  if (trs.length < period) return null;
  // 마지막 period개의 평균
  const lastTrs = trs.slice(-period);
  const atr = lastTrs.reduce((s, v) => s + v, 0) / period;
  return atr;
}

// === 볼린저밴드 (20기간, 2σ) ===
// 중심 = MA20, 상단 = MA20 + 2σ, 하단 = MA20 - 2σ
// 상단 = 매도 적지, 하단 = 매수 적지
function calculateBollingerBands(prices, period = 20, stddev = 2) {
  if (!prices || prices.length < period) return null;
  const closes = prices.map((p) => Number(p.close) || 0);
  const last = closes.slice(-period);
  const mean = last.reduce((s, v) => s + v, 0) / period;
  const variance = last.reduce((s, v) => s + (v - mean) * (v - mean), 0) / period;
  const std = Math.sqrt(variance);
  return {
    middle: mean,
    upper: mean + stddev * std,
    lower: mean - stddev * std,
    stddev: std,
  };
}

// === 52주 고가/저가 (약 250 거래일) ===
// 강한 저항(52주고가) / 최후 지지(52주신저가)
function calculate52Week(prices, days = 250) {
  if (!prices || prices.length < 20) return null;
  const closes = prices.slice(-days).map((p) => Number(p.close) || 0);
  const valid = closes.filter((c) => c > 0);
  if (valid.length === 0) return null;
  return {
    high: Math.max(...valid),
    low: Math.min(...valid),
    period: valid.length,
  };
}

// === RSI (Relative Strength Index, 14기간) ===
// 30 이하 = 과매도 (매수 적지), 70 이상 = 과매수 (매도 적지)
// 다이버전스: 가격新高 RSI低or 가격新低 RSI高 = 추세 전환 신호
function calculateRSI(prices, period = 14) {
  if (!prices || prices.length < period + 1) return null;
  const closes = prices.map((p) => Number(p.close) || 0);
  const gains = [];
  const losses = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains.push(diff);
    else losses.push(-diff);
  }
  if (gains.length < period) return null;
  // Wilder's smoothing
  let avgGain = gains.slice(0, period).reduce((s, v) => s + v, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((s, v) => s + v, 0) / period;
  // gains/losses 길이 비대칭 가능 → min length 사용
  const minLen = Math.min(gains.length, losses.length);
  for (let i = period; i < minLen; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }
  if (avgLoss === 0) return 100; // 전부 상승
  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);
  return rsi;
}

// === MACD (Moving Average Convergence Divergence, 12/26/9) ===
// MACD선 = EMA12 - EMA26
// Signal선 = MACD의 9일 EMA
// Histogram = MACD - Signal
// 골든크로스(MACD > Signal) = 매수, 데드크로스 = 매도
function calculateEMA(closes, period) {
  if (closes.length < period) return [];
  const k = 2 / (period + 1);
  const ema = [closes[0]];
  for (let i = 1; i < closes.length; i++) {
    ema.push(closes[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function calculateMACD(prices, fast = 12, slow = 26, signal = 9) {
  if (!prices || prices.length < slow + signal) return null;
  const closes = prices.map((p) => Number(p.close) || 0);
  const emaFast = calculateEMA(closes, fast);
  const emaSlow = calculateEMA(closes, slow);
  // MACD = EMA12 - EMA26
  const macdLine = [];
  for (let i = slow - 1; i < closes.length; i++) {
    macdLine.push(emaFast[i] - emaSlow[i]);
  }
  if (macdLine.length < signal) return null;
  // Signal = MACD의 signal기간 EMA
  const signalLine = calculateEMA(macdLine, signal);
  // 마지막 값
  const lastIdx = macdLine.length - 1;
  const macdLast = macdLine[lastIdx];
  const signalLast = signalLine[signalLine.length - 1];
  const histogramLast = macdLast - signalLast;
  // 이전 값 (크로스 감지용)
  const macdPrev = lastIdx >= 1 ? macdLine[lastIdx - 1] : macdLast;
  const signalPrev = signalLine.length >= 2 ? signalLine[signalLine.length - 2] : signalLast;
  return {
    macd: macdLast,
    signal: signalLast,
    histogram: histogramLast,
    prevMacd: macdPrev,
    prevSignal: signalPrev,
  };
}

// === 피보나치 되돌림 (Fibonacci Retracement) ===
// 60일 고점/저점 기준 23.6%, 38.2%, 61.8%, 78.6% 되돌림 레벨
// 상승 추세: 38.2%, 61.8% = 지지선
// 하락 추세: 38.2%, 61.8% = 저항선
function calculateFibonacci(prices, period = 60) {
  if (!prices || prices.length < period) return null;
  const last = prices.slice(-period);
  const high = Math.max(...last.map((p) => Number(p.high) || Number(p.close) || 0));
  const low = Math.min(...last.map((p) => Number(p.low) || Number(p.close) || 0));
  if (high <= 0 || low <= 0 || high <= low) return null;
  const range = high - low;
  return {
    high: Math.round(high),
    low: Math.round(low),
    range: Math.round(range),
    level_236: high - range * 0.236, // 23.6% 되돌림 (얕은 조정)
    level_382: high - range * 0.382, // 38.2% 되돌림 (중간 조정)
    level_500: high - range * 0.500, // 50% 되돌림 (절반)
    level_618: high - range * 0.618, // 61.8% 되돌림 (깊은 조정, 황금비)
    level_786: high - range * 0.786, // 78.6% 되돌림 (매우 깊은)
  };
}

module.exports = { calculateSignals, calculateVolumeProfile, calculateATR, calculateBollingerBands, calculate52Week, calculateRSI, calculateMACD, calculateFibonacci };
