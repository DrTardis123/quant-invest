'use strict';

// 기술적 분석 지표 계산 모듈
// 일봉 배열 [{date, open, high, low, close, volume, ...}, ...] 입력
// 최신 데이터가 배열 끝이라고 가정 (오래된 → 최신 순)

/**
 * 단순 이동평균 (SMA)
 * @param {number[]} closes 종가 배열
 * @param {number} period 기간
 * @returns {number[]} SMA 배열 (앞 period-1개는 null)
 */
function sma(closes, period) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i];
  out[period - 1] = sum / period;
  for (let i = period; i < closes.length; i++) {
    sum += closes[i] - closes[i - period];
    out[i] = sum / period;
  }
  return out;
}

/**
 * 지수 이동평균 (EMA)
 */
function ema(closes, period) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period) return out;
  const k = 2 / (period + 1);
  // 초기값 = SMA
  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i];
  out[period - 1] = sum / period;
  for (let i = period; i < closes.length; i++) {
    out[i] = closes[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

/**
 * RSI (Relative Strength Index) - Wilder 방식
 * period=14 기본
 */
function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;
  let avgGain = 0;
  let avgLoss = 0;
  // 첫 평균
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  // 이후 Wilder smoothing
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/**
 * MACD (Moving Average Convergence Divergence)
 * 12/26/9 기본
 */
function macd(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine = closes.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null,
  );
  // signal = EMA9 of macdLine
  const validMacd = macdLine.filter((v) => v != null);
  const signalEma = ema(validMacd, signal);
  // signalEma를 전체 길이에 맞춰 정렬
  const firstValid = macdLine.findIndex((v) => v != null);
  const fullSignal = new Array(closes.length).fill(null);
  for (let i = 0; i < signalEma.length; i++) {
    fullSignal[firstValid + i] = signalEma[i];
  }
  const histogram = macdLine.map((v, i) =>
    v != null && fullSignal[i] != null ? v - fullSignal[i] : null,
  );
  return { macd: macdLine, signal: fullSignal, histogram };
}

/**
 * 볼린저 밴드 (SMA 20, ±2σ)
 */
function bollinger(closes, period = 20, mult = 2) {
  const mid = sma(closes, period);
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let sumSq = 0;
    const m = mid[i];
    for (let j = i - period + 1; j <= i; j++) {
      sumSq += (closes[j] - m) ** 2;
    }
    const sd = Math.sqrt(sumSq / period);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { mid, upper, lower };
}

/**
 * 일간 변동성 (연율화, %)
 * std(log return) * sqrt(252) * 100
 */
function volatility(closes, period = 20) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;
  for (let i = period; i < closes.length; i++) {
    const rets = [];
    for (let j = i - period + 1; j <= i; j++) {
      rets.push(Math.log(closes[j] / closes[j - 1]));
    }
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length;
    out[i] = Math.sqrt(variance) * Math.sqrt(252) * 100;
  }
  return out;
}

/**
 * 메인 분석 함수: 일봉 배열 받아서 모든 지표 반환
 */
function analyze(prices) {
  if (!Array.isArray(prices) || prices.length === 0) {
    return { indicators: null, summary: null };
  }
  // prices: [{date, close, ...}] - 오래된 → 최신 순으로 정렬
  const sorted = [...prices].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const closes = sorted.map((p) => Number(p.close)).filter((c) => Number.isFinite(c));
  const volumes = sorted.map((p) => Number(p.volume) || 0);
  const dates = sorted.map((p) => p.date);

  if (closes.length < 20) {
    return { indicators: { dates, closes }, summary: null };
  }

  const ma5 = sma(closes, 5);
  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);
  const ma120 = sma(closes, 120);
  const rsi14 = rsi(closes, 14);
  const macdRes = macd(closes);
  const bb = bollinger(closes, 20, 2);
  const vol20 = volatility(closes, 20);

  // 마지막 값
  const lastIdx = closes.length - 1;
  const last = {
    close: closes[lastIdx],
    date: dates[lastIdx],
    ma5: ma5[lastIdx],
    ma20: ma20[lastIdx],
    ma60: ma60[lastIdx],
    ma120: ma120[lastIdx],
    rsi: rsi14[lastIdx],
    macd: macdRes.macd[lastIdx],
    macd_signal: macdRes.signal[lastIdx],
    macd_hist: macdRes.histogram[lastIdx],
    bb_upper: bb.upper[lastIdx],
    bb_mid: bb.mid[lastIdx],
    bb_lower: bb.lower[lastIdx],
    bb_pct_b: bb.upper[lastIdx] != null
      ? (closes[lastIdx] - bb.lower[lastIdx]) / (bb.upper[lastIdx] - bb.lower[lastIdx])
      : null,
    volatility_20d: vol20[lastIdx],
  };

  // 시그널 판정
  const signals = {
    ma_trend:
      last.ma5 == null || last.ma20 == null
        ? null
        : last.ma5 > last.ma20
          ? last.close > last.ma5
            ? '강한상승'
            : '약한상승'
          : last.close < last.ma5
            ? '강한하락'
            : '약한하락',
    rsi_zone:
      last.rsi == null
        ? null
        : last.rsi >= 70
          ? '과매수'
          : last.rsi <= 30
            ? '과매도'
            : last.rsi >= 50
              ? '중립(상)'
              : '중립(하)',
    macd_signal:
      last.macd == null || last.macd_signal == null
        ? null
        : last.macd > last.macd_signal
          ? last.macd_hist > 0
            ? '골든크로스↑'
            : '상향돌파'
          : last.macd_hist < 0
            ? '데드크로스↓'
            : '하향돌파',
    bb_position:
      last.bb_pct_b == null
        ? null
        : last.bb_pct_b > 1
          ? '상단밴드 위'
          : last.bb_pct_b < 0
            ? '하단밴드 아래'
            : last.bb_pct_b > 0.8
              ? '상단근접'
              : last.bb_pct_b < 0.2
                ? '하단근접'
                : '중립',
  };

  // 시리즈 (전체)
  const series = {
    ma5, ma20, ma60, ma120,
    rsi: rsi14,
    macd: macdRes.macd,
    macd_signal: macdRes.signal,
    macd_hist: macdRes.histogram,
    bb_upper: bb.upper,
    bb_mid: bb.mid,
    bb_lower: bb.lower,
    volatility: vol20,
  };

  return {
    indicators: {
      dates,
      closes,
      volumes,
      series,
    },
    summary: { last, signals },
  };
}

module.exports = { sma, ema, rsi, macd, bollinger, volatility, analyze };
