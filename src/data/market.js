// 시장 평가 점수 (Market Regime Score)
// CNN Fear & Greed Index 모델 기반 5지표 종합
// 점수: 1-100 (높을수록 강한 상승장, 만점 어려움 — 95 상한)
//
// 1) 추세 (25%) — KOSPI > MA60 > MA120 정배열 강도
// 2) 모멘텀 (20%) — KOSPI 5d/20d 변화율
// 3) Breadth (25%) — 전 종목 MA60/MA20 위 비율
// 4) 신고가/신저가 (15%) — 52주 신고가 - 신저가 비율
// 5) 변동성 (15%) — KOSPI 20d 변동성 (낮을수록 좋음)
//
// 점수 매핑:
//   80-100 강한 상승 (Strong Bull)
//   60-80  상승 (Bull)
//   40-60  중립 (Neutral)
//   20-40  하락 (Bear)
//   0-20   강한 하락 (Strong Bear)

const fs = require('fs');
const path = require('path');

// === SMA 계산 ===
function sma(arr, period) {
  if (!arr || arr.length < period) return null;
  let sum = 0;
  for (let i = arr.length - period; i < arr.length; i++) sum += Number(arr[i]) || 0;
  return sum / period;
}

// === 1) 추세 점수 (25%) ===
// KOSPI > MA20 > MA60 > MA120 정배열 + 이격도
function trendScore(closes) {
  if (!closes || closes.length < 130) return 50;
  const last = Number(closes[closes.length - 1]) || 0;
  const ma60 = sma(closes, 60);
  const ma120 = sma(closes, 120);
  const ma20 = sma(closes, 20);
  if (!ma60 || !ma120 || !ma20) return 50;

  const bullAligned = last > ma20 && ma20 > ma60 && ma60 > ma120;
  const bearAligned = last < ma20 && ma20 < ma60 && ma60 < ma120;

  const pctVsMa60 = ((last - ma60) / ma60) * 100;
  const pctVsMa120 = ((last - ma120) / ma120) * 100;

  let score = 50;
  if (bullAligned) score += 25;
  else if (bearAligned) score -= 25;
  score += Math.max(-20, Math.min(20, pctVsMa60 * 1.3));
  score += Math.max(-10, Math.min(10, pctVsMa120 * 0.7));

  return Math.max(1, Math.min(100, score));
}

// === 2) 모멘텀 점수 (20%) ===
function momentumScore(closes) {
  if (!closes || closes.length < 25) return 50;
  const last = Number(closes[closes.length - 1]) || 0;
  const c5 = Number(closes[closes.length - 6]) || last;
  const c20 = Number(closes[closes.length - 21]) || last;

  const change5 = ((last - c5) / c5) * 100;
  const change20 = ((last - c20) / c20) * 100;

  const s5 = 50 + Math.max(-30, Math.min(30, change5 * 6));
  const s20 = 50 + Math.max(-30, Math.min(30, change20 * 3));

  return Math.max(1, Math.min(100, (s5 * 0.6 + s20 * 0.4)));
}

// === 3) Breadth 점수 (25%) ===
function breadthScore(stocksList) {
  if (!Array.isArray(stocksList) || stocksList.length === 0) return 50;
  let above20 = 0;
  let above60 = 0;
  let valid20 = 0;
  let valid60 = 0;
  for (const s of stocksList) {
    if (s && s.close && s.ma20) {
      valid20++;
      if (s.close > s.ma20) above20++;
    }
    if (s && s.close && s.ma60) {
      valid60++;
      if (s.close > s.ma60) above60++;
    }
  }
  if (valid20 === 0 || valid60 === 0) return 50;
  const pct20 = (above20 / valid20) * 100;
  const pct60 = (above60 / valid60) * 100;
  const s20 = Math.max(1, Math.min(100, pct20));
  const s60 = Math.max(1, Math.min(100, pct60));
  return s20 * 0.6 + s60 * 0.4;
}

// === 4) 신고가/신저가 점수 (15%) ===
function newHighLowScore(stocksList) {
  if (!Array.isArray(stocksList) || stocksList.length === 0) return 50;
  let high = 0;
  let low = 0;
  let valid = 0;
  for (const s of stocksList) {
    if (s && s.close && s.high52 && s.low52) {
      valid++;
      if (s.close >= s.high52 * 0.95) high++;
      if (s.close <= s.low52 * 1.05) low++;
    }
  }
  if (valid === 0) return 50;
  const highPct = (high / valid) * 100;
  const lowPct = (low / valid) * 100;
  return Math.max(1, Math.min(100, 50 + (highPct - lowPct) * 2.5));
}

// === 5) 변동성 점수 (15%) ===
// KOSPI 20d 변동성 (연환산, %)
// 10% → 80, 20% → 60, 30% → 40, 40% → 20, 50% 이상 → 5
function volatilityScore(closes) {
  if (!closes || closes.length < 21) return 50;
  const recent = closes.slice(-21);
  const returns = [];
  for (let i = 1; i < recent.length; i++) {
    const r = (Number(recent[i]) - Number(recent[i - 1])) / Number(recent[i - 1]);
    returns.push(r);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  const dailyStd = Math.sqrt(variance);
  const annualVol = dailyStd * Math.sqrt(252) * 100;
  // 1% 변동성 → 2점 감산 (50% → 0, 15% → 70)
  const score = 100 - Math.max(0, (annualVol - 10) * 2);
  return Math.max(1, Math.min(100, score));
}

// === 시장 평가 점수 메인 ===
function calculateMarketRegime(marketData, breadthData = []) {
  const closes = (marketData && marketData.closes) || [];
  const trend = trendScore(closes);
  const momentum = momentumScore(closes);
  const breadth = breadthScore(breadthData);
  const newHighLow = newHighLowScore(breadthData);
  const vol = volatilityScore(closes);

  // 가중치
  const total = trend * 0.25 + momentum * 0.20 + breadth * 0.25 + newHighLow * 0.15 + vol * 0.15;
  // 만점 방지: 95 상한
  const finalScore = Math.min(95, total);

  let label = '중립';
  let emoji = '➖';
  let bgColor = '#9ca3af';
  let advice = '관망 유지';
  if (finalScore >= 80) {
    label = '강한 상승';
    emoji = '🚀';
    bgColor = '#10b981';
    advice = '적극 매수, 풀 포지션';
  } else if (finalScore >= 60) {
    label = '상승';
    emoji = '📈';
    bgColor = '#34d399';
    advice = '매수 우위, 비중 확대';
  } else if (finalScore >= 40) {
    label = '중립';
    emoji = '➖';
    bgColor = '#9ca3af';
    advice = '관망 유지, 선별 매수';
  } else if (finalScore >= 20) {
    label = '하락';
    emoji = '📉';
    bgColor = '#f87171';
    advice = '매수 자제, 현금 비중 확대';
  } else {
    label = '강한 하락';
    emoji = '💀';
    bgColor = '#dc2626';
    advice = '매수 금지, 현금 100%';
  }

  return {
    score: Math.round(finalScore * 10) / 10,
    label,
    emoji,
    bgColor,
    advice,
    components: {
      trend: { score: Math.round(trend * 10) / 10, weight: 0.25 },
      momentum: { score: Math.round(momentum * 10) / 10, weight: 0.20 },
      breadth: { score: Math.round(breadth * 10) / 10, weight: 0.25 },
      newHighLow: { score: Math.round(newHighLow * 10) / 10, weight: 0.15 },
      volatility: { score: Math.round(vol * 10) / 10, weight: 0.15 },
    },
    lastClose: marketData ? marketData.lastClose : null,
    lastDate: marketData ? marketData.lastDate : null,
    breadthSize: breadthData.length,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { calculateMarketRegime, trendScore, momentumScore, breadthScore, newHighLowScore, volatilityScore };

if (require.main === module) {
  // CLI 직접 실행 — DuckDB에서 KOSPI 일봉 + 전 종목 breadth 추출
  (async () => {
    const db = require('../db/connection');

    // 1) KOSPI 지수 — KOSPI 지수 종목 코드를 찾아서 가져오기
    // 우선 stocks 테이블에서 market='KOSPI' 또는 지수 코드를 조회
    const kospiIndexRow = await db.one(
      "SELECT code FROM stocks WHERE market = 'KOSPI' AND (code = 'KS11' OR name LIKE '%KOSPI%' OR name LIKE '%코스피%') LIMIT 1"
    ).catch(() => null);
    let kospiRows = [];
    if (kospiIndexRow && kospiIndexRow.code) {
      kospiRows = await db.all(
        "SELECT date, close FROM daily_prices WHERE code = $1 AND date >= (CURRENT_DATE - INTERVAL '400 days') ORDER BY date ASC",
        [kospiIndexRow.code]
      );
    }
    // KOSPI 지수 종목이 없으면 KOSPI 시장 모든 종목의 평균을 프록시로 사용 (fallback)
    if (kospiRows.length === 0) {
      console.log('[market-regime] KOSPI index not found, using market average as proxy');
      kospiRows = await db.all(`
        WITH kospi_avg AS (
          SELECT date, AVG(close) AS close
          FROM daily_prices
          WHERE code IN (SELECT code FROM stocks WHERE market = 'KOSPI')
          GROUP BY date
          ORDER BY date
        )
        SELECT date, close FROM kospi_avg
      `);
    }
    const closes = kospiRows.map((r) => Number(r.close));
    const lastRow = kospiRows[kospiRows.length - 1];
    console.log('[market-regime] KOSPI rows:', kospiRows.length, 'last:', lastRow ? lastRow.date : null);

    // 2) Breadth: 전 종목에서 close / ma20 / ma60 / high52 / low52 추출
    const breadthRows = await db.all(`
      WITH ranked AS (
        SELECT code, date, close, high, low,
          ROW_NUMBER() OVER (PARTITION BY code ORDER BY date DESC) AS rn
        FROM daily_prices
        WHERE date >= (SELECT MAX(date) - INTERVAL '400 days' FROM daily_prices)
      ),
      latest AS (
        SELECT code, close, high AS high52, low AS low52 FROM ranked WHERE rn = 1
      ),
      ma20_data AS (
        SELECT code, AVG(close) AS ma20
        FROM (SELECT code, close FROM ranked WHERE rn <= 20)
        GROUP BY code
      ),
      ma60_data AS (
        SELECT code, AVG(close) AS ma60
        FROM (SELECT code, close FROM ranked WHERE rn <= 60)
        GROUP BY code
      )
      SELECT l.code, l.close, l.high52, l.low52, m20.ma20, m60.ma60
      FROM latest l
      LEFT JOIN ma20_data m20 USING (code)
      LEFT JOIN ma60_data m60 USING (code)
    `);
    const breadthData = breadthRows.map((r) => ({
      close: r.close ? Number(r.close) : null,
      ma20: r.ma20 ? Number(r.ma20) : null,
      ma60: r.ma60 ? Number(r.ma60) : null,
      high52: r.high52 ? Number(r.high52) : null,
      low52: r.low52 ? Number(r.low52) : null,
    }));
    console.log('[market-regime] breadth rows:', breadthData.length);

    const marketData = {
      closes,
      lastClose: lastRow ? Number(lastRow.close) : null,
      lastDate: lastRow && lastRow.date
        ? (typeof lastRow.date === 'string'
            ? lastRow.date
            : `${lastRow.date.days ? new Date(Date.UTC(1970, 0, 1) + lastRow.date.days * 86400000).toISOString().slice(0, 10) : null}`)
        : null,
    };

    const result = calculateMarketRegime(marketData, breadthData);
    console.log(JSON.stringify(result, null, 2));

    // JSON 저장
    const outDir = path.resolve(__dirname, '..', '..', 'public', 'data');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'market-regime.json');
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
    console.log('[market-regime] saved →', outPath);

    await db.close();
  })().catch((e) => {
    console.error('[market-regime] error:', e);
    process.exit(1);
  });
}
