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

  // === ADX + 캔들 패턴 (buy1/buy2 매트릭스 가산용, buy1Score보다 먼저 계산) ===
  const adx = calculateADX(prices, 14);
  const candlePatterns = detectCandlePatterns(prices);
  const adxValue = adx ? adx.adx : 0;
  const adxTrend = adx ? adx.trend : 'UNKNOWN';
  const adxDirection = adx ? adx.direction : 'NEUTRAL';
  const adxStrong = adxValue >= 25;
  const adxWeak = adxValue < 20;
  const adxUpTrend = adxDirection === 'UP';
  const adxDownTrend = adxDirection === 'DOWN';
  const bullishPatterns = candlePatterns.filter((p) => p.type === 'BULLISH');
  const bearishPatterns = candlePatterns.filter((p) => p.type === 'BEARISH');
  const hasBullishPattern = bullishPatterns.length > 0;
  const hasBearishPattern = bearishPatterns.length > 0;
  const hasStrongBullish = bullishPatterns.some((p) => p.strength === 'STRONG');
  const hasStrongBearish = bearishPatterns.some((p) => p.strength === 'STRONG');

  // === OBV / 스윙 / Polarity / 라운드 (수급·심리 보조) ===
  const obv = calculateOBV(prices, 20);
  const swing = findSwingPoints(prices, 5);
  const polarity = detectPolarityFlip(prices, 60);
  const round = findRoundNumberLevels(last);
  const obvUp = obv && obv.trend === 'UP';
  const obvDown = obv && obv.trend === 'DOWN';
  const obvBullishDiv = obv && obv.bullishDivergence; // 가격↓ OBV↑ = 매수세 유입
  const obvBearishDiv = obv && obv.bearishDivergence; // 가격↑ OBV↓ = 매도 압력
  const nearRecentLow = swing && swing.recentLow && Math.abs(last - swing.recentLow) / last <= 0.05; // 5% 이내
  const nearRecentHigh = swing && swing.recentHigh && Math.abs(last - swing.recentHigh) / last <= 0.05;
  const hasFlippedResistance = polarity && polarity.brokenBelow; // 저항선으로 전환
  const hasFlippedSupport = polarity && polarity.brokenAbove; // 지지선으로 전환
  const nearRoundLower = round && round.distanceToLower / last <= 0.03; // 3% 이내
  const nearRoundUpper = round && round.distanceToUpper / last <= 0.03;

  let buy1Score = 0;
  const buy1Reasons = [];
  // === 가산 점수 균등화 (14개 요소 × ~7점) ===
  // MA / 정배열 (기존 30+25+15+10 = 80점 → 축소)
  if (isGoldenCrossNow) { buy1Score += 10; buy1Reasons.push('5일↑20일 골든크로스 (방금)'); }
  else if (isGoldenCrossRecent) { buy1Score += 7; buy1Reasons.push('5일↑20일 골든크로스 (3일 내)'); }
  if (isAligned) { buy1Score += 10; buy1Reasons.push('정배열 (5>20>60)'); }
  if (ma20Rising) { buy1Score += 5; buy1Reasons.push('20일선 우상향'); }
  if (ma60Rising) { buy1Score += 5; buy1Reasons.push('60일선 우상향'); }
  if (volSurge) { buy1Score += 5; buy1Reasons.push('거래량 1.0x↑ (평균 이상)'); }
  if (nearHigh60) { buy1Score += 3; buy1Reasons.push('60일 고가 5% 이내'); }
  // 매물대 (POC/지지선)
  if (nearPoc) { buy1Score += 7; buy1Reasons.push(`POC(${vpEarly.poc.price.toLocaleString(undefined,{maximumFractionDigits:0})}원) 부근 (지지선)`); }
  if (nearSupport) { buy1Score += 5; buy1Reasons.push('지지선 부근 (반등 기대)'); }
  // ADX (상향)
  if (adxStrong && adxUpTrend) { buy1Score += 7; buy1Reasons.push(`ADX ${adxValue.toFixed(1)} 강한 상승 추세`); }
  else if (adxStrong && adxDownTrend) { buy1Score -= 3; buy1Reasons.push(`ADX ${adxValue.toFixed(1)} 강한 하락 추세 (역행)`); }
  else if (adxWeak) { buy1Reasons.push(`ADX ${adxValue.toFixed(1)} 약한 추세 (관망)`); }
  // 캔들
  if (hasStrongBullish) { buy1Score += 10; buy1Reasons.push(`강한 상승 반전 캔들: ${bullishPatterns.find((p) => p.strength === 'STRONG').name}`); }
  else if (hasBullishPattern) { buy1Score += 5; buy1Reasons.push(`상승 반전 캔들: ${bullishPatterns[0].name}`); }
  if (hasStrongBearish) { buy1Score -= 7; buy1Reasons.push(`강한 하락 반전 캔들 (매수 자제): ${bearishPatterns.find((p) => p.strength === 'STRONG').name}`); }
  // OBV
  if (obvUp) { buy1Score += 5; buy1Reasons.push('OBV 상승 (수급 유입)'); }
  if (obvBullishDiv) { buy1Score += 7; buy1Reasons.push('OBV 강세 다이버전스'); }
  if (obvDown) { buy1Score -= 3; buy1Reasons.push('OBV 하락 (수급 이탈)'); }
  // 스윙
  if (nearRecentLow) { buy1Score += 5; buy1Reasons.push(`최근 스윙 로우(${swing.recentLow.toLocaleString()}) 부근`); }
  if (nearRecentHigh) { buy1Score -= 3; buy1Reasons.push(`최근 스윙 하이(${swing.recentHigh.toLocaleString()}) 부근 (저항)`); }
  // Polarity
  if (hasFlippedSupport) { buy1Score += 5; buy1Reasons.push(`지지선 역할 전환: ${polarity.flippedSupport.toLocaleString()} (구 고점)`); }
  // 라운드
  if (nearRoundLower) { buy1Score += 5; buy1Reasons.push(`라운드 넘버 ${round.lower.toLocaleString()} (심리적 지지)`); }
  // === 활성 조건 다중화 (4가지 신호) ===
  // 1안: MA/정배열 추세 진입 (기존, 약화)
  const buy1ByMa = isGoldenCrossNow || (isAligned && volSurge && ma20Rising);
  // 2안: 모멘텀 반전 (강한상승캔들 + ADX STRONG + OBV UP) — MA 무관
  const buy1ByMomentum = hasStrongBullish && adxStrong && adxUpTrend && obvUp;
  // 3안: 심리적 지지 반등 (지지선/라운드 + OBV UP) — MA 무관
  const buy1BySupport = (nearPoc || nearSupport || nearRoundLower) && obvUp;
  // 4안: 구조적 반등 (Polarity 지지전환 + 캔들반전) — MA 무관
  const buy1ByStructure = hasFlippedSupport && hasBullishPattern;
  // 강한 하락 캔들 + 강한 하락 추세면 매수 비활성
  const buy1Suppressed = hasStrongBearish && adxStrong && adxDownTrend;
  const buy1Active = !buy1Suppressed && (buy1ByMa || buy1ByMomentum || buy1BySupport || buy1ByStructure);

  // === 2차매수 (눌림목: 5일선 근처 + 양봉 + 거래량 감소 + 20일선 우상향) — 조건 완화 ===
  const nearMa5 = last >= ma5 * 0.98 && last <= ma5 * 1.02; // 5일선 ±2%
  const nearMa20 = last >= ma20 * 0.95 && last <= ma20 * 1.02; // 20일선 위 ~5% 이내
  const isBullishCandle = last > closePrev; // 양봉
  const volDecline = volLast < volMa5 * 0.9; // 거래량 5일 평균보다 10%+ 감소 (완화, 0.8x→0.9x)
  const ma20RisingFor2 = ma20 > ma20FiveAgo;
  const aboveMa60 = last > ma60; // 60일선 위

  let buy2Score = 0;
  const buy2Reasons = [];
  // === 가산 점수 균등화 ===
  // 눌림목 (기존 30+25+20+15+10 = 100점 → 축소)
  if (nearMa5) { buy2Score += 7; buy2Reasons.push('5일선 ±2% 눌림'); }
  else if (nearMa20) { buy2Score += 5; buy2Reasons.push('20일선 위 -5% 눌림'); }
  if (isBullishCandle) { buy2Score += 5; buy2Reasons.push('당일 양봉'); }
  if (volDecline) { buy2Score += 5; buy2Reasons.push('거래량 0.9x↓ (건강한 조정)'); }
  if (ma20RisingFor2) { buy2Score += 5; buy2Reasons.push('20일선 우상향 (추세 유지)'); }
  if (aboveMa60) { buy2Score += 5; buy2Reasons.push('60일선 위 (장기 추세)'); }
  // 매물대 (2차매수가 ma60 ≈ POC/지지선)
  if (vpEarly) {
    if (vpEarly.poc && Math.abs(ma60 - vpEarly.poc.price) / ma60 <= 0.10) { buy2Score += 7; buy2Reasons.push(`POC 부근 2차매수가`); }
    if (vpEarly.supportLines && vpEarly.supportLines.some((p) => Math.abs(ma60 - p) / ma60 <= 0.10)) { buy2Score += 5; buy2Reasons.push('지지선 부근 2차매수가'); }
  }
  // ADX
  if (adxStrong && adxUpTrend) { buy2Score += 5; buy2Reasons.push(`ADX 강한 상승 추세 (눌림 적지)`); }
  if (hasStrongBullish) { buy2Score += 10; buy2Reasons.push(`강한 상승 반전 캔들: ${bullishPatterns.find((p) => p.strength === 'STRONG').name}`); }
  else if (hasBullishPattern) { buy2Score += 5; buy2Reasons.push(`상승 반전 캔들: ${bullishPatterns[0].name}`); }
  if (hasStrongBearish) { buy2Score -= 5; buy2Reasons.push(`하락 반전 캔들 (매수 자제)`); }
  // OBV / 스윙 / Polarity / 라운드
  if (obvUp) { buy2Score += 5; buy2Reasons.push('OBV 상승 (눌림 매수 적지)'); }
  if (obvBullishDiv) { buy2Score += 7; buy2Reasons.push('OBV 강세 다이버전스'); }
  if (nearRecentLow) { buy2Score += 5; buy2Reasons.push(`최근 스윙 로우 부근 (지지)`); }
  if (hasFlippedSupport) { buy2Score += 5; buy2Reasons.push(`지지선 역할 전환 (${polarity.flippedSupport.toLocaleString()})`); }
  if (nearRoundLower) { buy2Score += 5; buy2Reasons.push(`라운드 넘버 ${round.lower.toLocaleString()}`); }
  // === 활성 조건 다중화 (2가지 신호) ===
  // 1안: 기존 눌림목 (5일선/20일선 근처 + 양봉 + 거래량감소 + ma20우상향 + 60일선 위)
  const buy2ByPullback = (nearMa5 || nearMa20) && isBullishCandle && volDecline && ma20RisingFor2 && aboveMa60;
  // 2안: 깊은 반등 (지지선 + 강한 캔들 + OBV UP) — MA 무관
  const buy2ByDeep = (nearPoc || nearSupport) && hasStrongBullish && obvUp;
  const buy2Suppressed = hasStrongBearish && adxStrong && adxDownTrend;
  const buy2Active = !buy2Suppressed && (buy2ByPullback || buy2ByDeep);

  // === 추가 기술 지표 (ATR/볼린저/52주/RSI/MACD/피보나치/이격도) ===
  // ATR(14): 변동성 → 손절폭 조정
  // 볼린저밴드(20, 2σ): 상단 = 저항, 하단 = 지지
  // 52주 신고가: 강한 저항, 52주 신저가: 최후 지지
  // RSI(14): 30↓ 과매도, 70↑ 과매수, 다이버전스 = 추세 전환
  // MACD(12,26,9): Signal선 교차 + 0선 위 = 모멘텀
  // 피보나치 되돌림: 23.6%, 38.2%, 61.8% = 지지/저항
  // 이격도: 현재가 vs MA 괴리율 = 과매수/과매도
  // ADX/캔들 패턴은 위에서 이미 계산됨 (buy1/buy2 가산용)
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
  // ADX + 캔들 가산
  if (adxStrong && adxDownTrend) { sell1Score += 10; sell1Reasons.push(`ADX ${adxValue.toFixed(1)} 강한 하락 추세 (손절 권고)`); }
  if (hasStrongBearish) { sell1Score += 20; sell1Reasons.push(`강한 하락 반전 캔들: ${bearishPatterns.find((p) => p.strength === 'STRONG').name}`); }
  else if (hasBearishPattern) { sell1Score += 10; sell1Reasons.push(`하락 반전 캔들: ${bearishPatterns[0].name}`); }
  // OBV 약세 다이버전스 / 수급 이탈
  if (obvBearishDiv) { sell1Score += 15; sell1Reasons.push('OBV 약세 다이버전스 (가격↑ 거래량↓)'); }
  if (obvDown && profitPctFromBuy1 > 5) { sell1Score += 8; sell1Reasons.push('OBV 하락 + 수익 중 (매도 적지)'); }
  // 스윙 하이 부근 (저항 매도)
  if (nearRecentHigh) { sell1Score += 8; sell1Reasons.push(`최근 스윙 하이(${swing.recentHigh.toLocaleString()}) 부근 (저항)`); }
  // Polarity: 지지→저항 역할 전환된 가격 근처
  if (hasFlippedResistance && Math.abs(last - polarity.flippedResistance) / last <= 0.05) {
    sell1Score += 8; sell1Reasons.push(`저항선 역할 전환 (${polarity.flippedResistance.toLocaleString()}, 구 저점)`);
  }
  // 라운드 넘버 (저항)
  if (nearRoundUpper) { sell1Score += 5; sell1Reasons.push(`라운드 넘버 ${round.upper.toLocaleString()} (심리적 저항)`); }
  const sell1Active = profitPctFromBuy1 >= 15 || belowMa20 || lossPctFromBuy1 <= -8 || rsiOverbought || macdCrossDown || (adxStrong && adxDownTrend) || hasStrongBearish || obvBearishDiv;

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
      adx: {
        value: round2(adxValue),
        plusDI: adx ? round2(adx.plusDI) : 0,
        minusDI: adx ? round2(adx.minusDI) : 0,
        trend: adxTrend, // STRONG / BUILDING / WEAK
        direction: adxDirection, // UP / DOWN
        strong: adxStrong,
        weak: adxWeak,
      },
      candles: {
        patterns: candlePatterns,
        bullishCount: bullishPatterns.length,
        bearishCount: bearishPatterns.length,
        hasStrongBullish,
        hasStrongBearish,
      },
      obv: obv ? {
        trend: obv.trend,
        bullishDivergence: obv.bullishDivergence,
        bearishDivergence: obv.bearishDivergence,
        delta: obv.delta,
      } : null,
      swing: swing ? {
        recentLow: swing.recentLow,
        recentHigh: swing.recentHigh,
        lowCount: swing.lowCount,
        highCount: swing.highCount,
        nearRecentLow,
        nearRecentHigh,
      } : null,
      polarity: polarity ? {
        recentHigh: polarity.recentHigh,
        recentLow: polarity.recentLow,
        brokenBelow: polarity.brokenBelow,
        brokenAbove: polarity.brokenAbove,
        flippedResistance: polarity.flippedResistance,
        flippedSupport: polarity.flippedSupport,
      } : null,
      round: round ? {
        unit: round.unit,
        lower: round.lower,
        upper: round.upper,
        distanceToLower: round.distanceToLower,
        distanceToUpper: round.distanceToUpper,
        nearLower: nearRoundLower,
        nearUpper: nearRoundUpper,
      } : null,
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

// === ADX (Average Directional Index, 14기간) ===
// 추세 강도 측정: 0~25 약한 추세, 25~50 강한 추세, 50~75 매우 강한, 75+ 극강
// ADX만으로 매수/매도 판단 X → 추세 존재 여부 확인
// +DI > -DI: 상승 추세 우세, -DI > +DI: 하락 추세 우세
function calculateADX(prices, period = 14) {
  if (!prices || prices.length < period * 2 + 1) return null;
  const ohlc = prices.map((p) => ({
    high: Number(p.high) || 0,
    low: Number(p.low) || 0,
    close: Number(p.close) || 0,
  }));
  // 1) +DM, -DM, TR 계산
  const plusDM = [0];
  const minusDM = [0];
  const tr = [0];
  for (let i = 1; i < ohlc.length; i++) {
    const upMove = ohlc[i].high - ohlc[i - 1].high;
    const downMove = ohlc[i - 1].low - ohlc[i].low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    const trVal = Math.max(
      ohlc[i].high - ohlc[i].low,
      Math.abs(ohlc[i].high - ohlc[i - 1].close),
      Math.abs(ohlc[i].low - ohlc[i - 1].close)
    );
    tr.push(trVal);
  }
  // 2) Wilder's smoothing
  const smooth = (arr) => {
    let sum = arr.slice(1, period + 1).reduce((s, v) => s + v, 0);
    const out = [sum];
    for (let i = period + 1; i < arr.length; i++) {
      sum = sum - sum / period + arr[i];
      out.push(sum);
    }
    return out;
  };
  const trSmooth = smooth(tr);
  const plusDMSmooth = smooth(plusDM);
  const minusDMSmooth = smooth(minusDM);
  if (trSmooth.length === 0) return null;
  // 3) +DI, -DI
  const plusDI = plusDMSmooth.map((v, i) => trSmooth[i] > 0 ? 100 * v / trSmooth[i] : 0);
  const minusDI = minusDMSmooth.map((v, i) => trSmooth[i] > 0 ? 100 * v / trSmooth[i] : 0);
  // 4) DX
  const dx = plusDI.map((p, i) => {
    const sum = p + minusDI[i];
    return sum > 0 ? 100 * Math.abs(p - minusDI[i]) / sum : 0;
  });
  if (dx.length < period) return null;
  // 5) ADX = DX의 period EMA
  let adx = dx.slice(0, period).reduce((s, v) => s + v, 0) / period;
  const adxArr = [adx];
  for (let i = period; i < dx.length; i++) {
    adx = (adx * (period - 1) + dx[i]) / period;
    adxArr.push(adx);
  }
  const lastIdx = adxArr.length - 1;
  return {
    adx: adxArr[lastIdx],
    plusDI: plusDI[plusDI.length - 1],
    minusDI: minusDI[minusDI.length - 1],
    trend: adxArr[lastIdx] >= 25 ? 'STRONG' : adxArr[lastIdx] >= 20 ? 'BUILDING' : 'WEAK',
    direction: plusDI[plusDI.length - 1] > minusDI[minusDI.length - 1] ? 'UP' : 'DOWN',
  };
}

// === 캔들 패턴 감지 (Candle Pattern Detection) ===
// 1) Bullish Engulfing: 전일 음봉 + 당일 양봉이 전일 몸통 포함
// 2) Bearish Engulfing: 전일 양봉 + 당일 음봉이 전일 몸통 포함
// 3) Hammer (망치형): 긴 아래 그림자 + 작은 몸통 위쪽 + 짧은 위 그림자
// 4) Hanging Man (교수형): 망치형과 같지만 상승 추세 끝 (당일 양봉)
// 5) Dragonfly Doji (용아치): 시가=종가, 긴 아래 그림자 → 강한 반등 신호
// 6) Morning Star (샛별): 큰 음봉 + 작은 도지 + 큰 양봉 (3일)
// 7) Evening Star (어두운 샛별): 큰 양봉 + 작은 도지 + 큰 음봉 (3일)
function detectCandlePatterns(prices) {
  if (!prices || prices.length < 3) return [];
  const patterns = [];
  const ohlc = prices.map((p) => ({
    open: Number(p.open) || Number(p.close) || 0,
    high: Number(p.high) || Number(p.close) || 0,
    low: Number(p.low) || Number(p.close) || 0,
    close: Number(p.close) || 0,
  }));
  const last = ohlc[ohlc.length - 1];
  const prev = ohlc[ohlc.length - 2];
  const prev2 = ohlc[ohlc.length - 3];

  // 몸통/그림자 계산
  const bodySize = (c) => Math.abs(c.close - c.open);
  const upperShadow = (c) => c.high - Math.max(c.open, c.close);
  const lowerShadow = (c) => Math.min(c.open, c.close) - c.low;
  const range = (c) => c.high - c.low;
  const isBullish = (c) => c.close > c.open;
  const isBearish = (c) => c.close < c.open;
  const isDoji = (c) => bodySize(c) <= range(c) * 0.1;

  // 1) Bullish Engulfing (당일이 전일 몸통을 완전히 감싸는 양봉)
  if (isBearish(prev) && isBullish(last) &&
      last.open < prev.close && last.close > prev.open) {
    patterns.push({ name: 'Bullish Engulfing', type: 'BULLISH', strength: 'STRONG',
      desc: '전일 음봉을 당일 양봉이 완전 장악 → 상승 반전 신호' });
  }
  // 2) Bearish Engulfing
  if (isBullish(prev) && isBearish(last) &&
      last.open > prev.close && last.close < prev.open) {
    patterns.push({ name: 'Bearish Engulfing', type: 'BEARISH', strength: 'STRONG',
      desc: '전일 양봉을 당일 음봉이 완전 장악 → 하락 반전 신호' });
  }
  // 3) Hammer (당일): 긴 아래 그림자 (몸통 2배 이상) + 짧은 위 그림자
  if (isBullish(last) && lowerShadow(last) >= bodySize(last) * 2 && upperShadow(last) <= bodySize(last) * 0.5 && range(last) > 0) {
    patterns.push({ name: 'Hammer (망치형)', type: 'BULLISH', strength: 'MEDIUM',
      desc: '긴 아래 그림자 → 매수세 유입, 하락 추세 끝 신호' });
  }
  // 4) Hanging Man (당일 양봉 + 망치형) — 상승 추세 끝
  if (isBullish(last) && lowerShadow(last) >= bodySize(last) * 2 && upperShadow(last) <= bodySize(last) * 0.5) {
    // Hammer와 동일하지만 컨텍스트로 구분 (이름만 다름)
    // patterns.push은 중복 안 되게 위에서 이미 추가
  }
  // 5) Dragonfly Doji: 시가=종가, 긴 아래 그림자
  if (isDoji(last) && lowerShadow(last) >= range(last) * 0.6) {
    patterns.push({ name: 'Dragonfly Doji (용아치)', type: 'BULLISH', strength: 'STRONG',
      desc: '시종가 동일 + 긴 아래 그림자 → 강한 반등 신호' });
  }
  // 6) Morning Star (3일): 큰 음봉 + 작은 도지 + 큰 양봉
  if (isBearish(prev2) && isDoji(prev) && isBullish(last) &&
      bodySize(prev2) > range(prev2) * 0.5 && bodySize(last) > range(last) * 0.5) {
    patterns.push({ name: 'Morning Star (샛별)', type: 'BULLISH', strength: 'STRONG',
      desc: '큰 음봉 + 작은 도지 + 큰 양봉 → 강한 상승 반전' });
  }
  // 7) Evening Star (3일)
  if (isBullish(prev2) && isDoji(prev) && isBearish(last) &&
      bodySize(prev2) > range(prev2) * 0.5 && bodySize(last) > range(last) * 0.5) {
    patterns.push({ name: 'Evening Star (어두운 샛별)', type: 'BEARISH', strength: 'STRONG',
      desc: '큰 양봉 + 작은 도지 + 큰 음봉 → 강한 하락 반전' });
  }
  return patterns;
}

// === OBV (On Balance Volume) ===
// 거래량 누적 흐름: 종가 상승 시 +volume, 하락 시 -volume
// OBV 추세 = 가격 추세 확인 / OBV 다이버전스 = 추세 전환 신호
function calculateOBV(prices, smaPeriod = 20) {
  if (!prices || prices.length < smaPeriod + 1) return null;
  const closes = prices.map((p) => Number(p.close) || 0);
  const volumes = prices.map((p) => Number(p.volume) || 0);
  // 1) OBV 계산
  const obv = [0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) obv.push(obv[i - 1] + volumes[i]);
    else if (closes[i] < closes[i - 1]) obv.push(obv[i - 1] - volumes[i]);
    else obv.push(obv[i - 1]);
  }
  // 2) OBV SMA 5/20
  const obvSma = (n) => {
    if (obv.length < n) return 0;
    const slice = obv.slice(-n);
    return slice.reduce((s, v) => s + v, 0) / n;
  };
  const obvSma5 = obvSma(5);
  const obvSma20 = obvSma(20);
  const obvLast = obv[obv.length - 1];
  // 3) 추세: SMA5 > SMA20 → 상승, 반대 → 하락
  const trend = obvSma5 > obvSma20 ? 'UP' : obvSma5 < obvSma20 ? 'DOWN' : 'NEUTRAL';
  // 4) 가격-OBV 다이버전스: 가격 신저 vs OBV 신저 (강세 다이버전스) or 가격 신고 vs OBV 신고 (약세)
  const closesLast20 = closes.slice(-20);
  const obvLast20 = obv.slice(-20);
  const priceTrend20 = closesLast20[closesLast20.length - 1] - closesLast20[0];
  const obvTrend20 = obvLast20[obvLast20.length - 1] - obvLast20[0];
  const bullishDiv = priceTrend20 < 0 && obvTrend20 > 0; // 가격 하락 + OBV 상승 = 매수세 유입
  const bearishDiv = priceTrend20 > 0 && obvTrend20 < 0; // 가격 상승 + OBV 하락 = 매도 압력
  return {
    value: obvLast,
    sma5: obvSma5,
    sma20: obvSma20,
    trend,
    bullishDivergence: bullishDiv,
    bearishDivergence: bearishDiv,
    delta: obvSma5 - obvSma20,
  };
}

// === 스윙 로우/하이 (Swing Low/High) 자동 감지 ===
// 좌우 lookback 봉보다 낮은 저점 = 스윙 로우, 높은 고점 = 스윙 하이
// 추세선/지지저항 자동 생성에 활용
function findSwingPoints(prices, lookback = 5) {
  if (!prices || prices.length < lookback * 2 + 1) return null;
  const ohlc = prices.map((p) => ({
    high: Number(p.high) || Number(p.close) || 0,
    low: Number(p.low) || Number(p.close) || 0,
  }));
  const swingLows = [];
  const swingHighs = [];
  for (let i = lookback; i < ohlc.length - lookback; i++) {
    const cur = ohlc[i];
    // 스윙 로우: 좌우 lookback 봉 모두보다 낮음
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (ohlc[i - j].low <= cur.low || ohlc[i + j].low <= cur.low) {
        isLow = false; break;
      }
    }
    if (isLow) swingLows.push({ idx: i, price: cur.low });
    // 스윙 하이
    let isHigh = true;
    for (let j = 1; j <= lookback; j++) {
      if (ohlc[i - j].high >= cur.high || ohlc[i + j].high >= cur.high) {
        isHigh = false; break;
      }
    }
    if (isHigh) swingHighs.push({ idx: i, price: cur.high });
  }
  return {
    lows: swingLows.map((s) => s.price),
    highs: swingHighs.map((s) => s.price),
    recentLow: swingLows.length > 0 ? swingLows[swingLows.length - 1].price : null,
    recentHigh: swingHighs.length > 0 ? swingHighs[swingHighs.length - 1].price : null,
    lowCount: swingLows.length,
    highCount: swingHighs.length,
  };
}

// === Polarity Flip (지지↔저항 역할 전환) ===
// 최근 N일 저점을 종가가 이탈 → 그 저점이 저항선으로 전환
// 최근 N일 고점을 종가가 돌파 → 그 고점이 지지선으로 전환
function detectPolarityFlip(prices, lookback = 60) {
  if (!prices || prices.length < lookback + 1) return null;
  const closes = prices.map((p) => Number(p.close) || 0);
  const last = closes[closes.length - 1];
  const recent = prices.slice(-lookback).map((p, i, arr) => ({
    high: Number(p.high) || Number(p.close) || 0,
    low: Number(p.low) || Number(p.close) || 0,
  }));
  const recentHigh = Math.max(...recent.map((r) => r.high));
  const recentLow = Math.min(...recent.map((r) => r.low));
  // 역할 전환 감지: 최근 가격이 저점을 깨고 내려갔는지 / 고점을 돌파했는지
  const brokenBelow = recentLow > last; // 저점 아래로 내려감 → 그 저점이 저항선으로 전환
  const brokenAbove = recentHigh < last; // 고점 위로 올라감 → 그 고점이 지지선으로 전환
  return {
    recentHigh,
    recentLow,
    brokenBelow, // true면 recentLow가 저항선으로 전환됨
    brokenAbove, // true면 recentHigh가 지지선으로 전환됨
    flippedResistance: brokenBelow ? recentLow : null,
    flippedSupport: brokenAbove ? recentHigh : null,
  };
}

// === 라운드 넘버 (Round Number, 심리적 지지/저항) ===
// 1,000원, 5,000원, 10,000원 단위 (가격대별 자동)
// 1,000원 미만: 100원 단위 / 1,000~10,000: 1,000원 / 1만원~10만원: 5,000원 / 10만원~: 10,000원
function findRoundNumberLevels(currentPrice) {
  if (currentPrice <= 0) return null;
  let unit;
  if (currentPrice < 1000) unit = 100;
  else if (currentPrice < 10000) unit = 1000;
  else if (currentPrice < 100000) unit = 5000;
  else unit = 10000;
  const lower = Math.floor(currentPrice / unit) * unit;
  const upper = lower + unit;
  return {
    unit,
    lower, // 현재가 아래 라운드 넘버 (지지 후보)
    upper, // 현재가 위 라운드 넘버 (저항 후보)
    distanceToLower: currentPrice - lower, // 0이면 정확히 라운드
    distanceToUpper: upper - currentPrice,
  };
}

module.exports = { calculateSignals, calculateVolumeProfile, calculateATR, calculateBollingerBands, calculate52Week, calculateRSI, calculateMACD, calculateFibonacci, calculateADX, detectCandlePatterns, calculateOBV, findSwingPoints, detectPolarityFlip, findRoundNumberLevels };
