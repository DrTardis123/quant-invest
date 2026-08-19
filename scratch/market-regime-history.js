// 시장 평가 점수 시계열 (과거 60일)
// 매일의 KOSPI 일봉 + 그 시점의 breadth로 시장 평가 점수 계산
'use strict';
process.chdir('C:/Users/LG/Documents/quant_invest');
process.env.DUCKDB_READ_ONLY = '1';
const fs = require('fs');
const path = require('path');
const db = require('../src/db/connection');
const { calculateMarketRegime } = require('../src/data/market');

function dateToStr(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  if (typeof d === 'bigint') return new Date(Number(d) * 86400000).toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

(async () => {
  // 1) KOSPI 일봉 (시계열용, 최근 200일, 일자 unique)
  const kospiRows = await db.all(`
    SELECT date, AVG(close) AS close FROM daily_prices
    WHERE code IN (SELECT code FROM stocks WHERE market = 'KOSPI' AND (name LIKE '%KOSPI%' OR name LIKE '%코스피%' OR code = 'KS11'))
    AND date >= (CURRENT_DATE - INTERVAL '400 days')
    GROUP BY date
    ORDER BY date ASC
  `);
  const allCloses = kospiRows.map((r) => Number(r.close));
  const allDates = kospiRows.map((r) => dateToStr(r.date));
  console.log(`KOSPI 일봉: ${kospiRows.length}행 (unique 날짜)`);

  // 2) 매일의 breadth (매일 그 시점의 ma20/ma60 있는 종목 수)
  // 효율: 60일 단위로 일자 추출, 그 날짜의 ma20/ma60
  // 시뮬레이션: 각 날짜 D에 대해 D 시점까지의 데이터로 ma20/ma60 계산
  // 무거우므로 최근 60일만
  const days = 60;
  const startIdx = allCloses.length - days;
  if (startIdx < 0) { console.log('데이터 부족'); return; }

  // 3) 매일의 breadth 데이터 (전 종목의 그 시점 ma20/ma60/high52/low52)
  // DuckDB window 함수로 일자별 계산
  const dailyBreadth = await db.all(`
    WITH dates AS (
      SELECT DISTINCT date FROM daily_prices
      WHERE date >= (CURRENT_DATE - INTERVAL '${days + 130} days')
      ORDER BY date DESC LIMIT ${days}
    ),
    ranked AS (
      SELECT d.date as target_date, p.code, p.date, p.close, p.high, p.low,
        ROW_NUMBER() OVER (PARTITION BY p.code, d.date ORDER BY p.date DESC) AS rn
      FROM dates d JOIN daily_prices p ON p.date <= d.date
    ),
    ma20 AS (
      SELECT target_date, code, AVG(close) AS ma20
      FROM ranked WHERE rn <= 20 GROUP BY target_date, code
    ),
    ma60 AS (
      SELECT target_date, code, AVG(close) AS ma60
      FROM ranked WHERE rn <= 60 GROUP BY target_date, code
    ),
    latest52 AS (
      SELECT target_date, code,
        MAX(high) AS high52,
        MIN(low) AS low52
      FROM ranked WHERE rn <= 250 GROUP BY target_date, code
    )
    SELECT m20.target_date, m20.code, m20.ma20, m60.ma60, l.high52, l.low52,
      (SELECT close FROM ranked r WHERE r.target_date = m20.target_date AND r.code = m20.code AND r.rn = 1) AS close
    FROM ma20 m20
    JOIN ma60 m60 ON m20.target_date = m60.target_date AND m20.code = m60.code
    JOIN latest52 l ON m20.target_date = l.target_date AND m20.code = l.code
  `);
  console.log(`daily breadth rows: ${dailyBreadth.length}`);

  // 4) 일자별로 그룹화 → 그 날의 marketData/closesslice + 그 날의 breadth로 calculateMarketRegime
  const byDate = new Map();
  for (const r of dailyBreadth) {
    const d = dateToStr(r.target_date);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push({
      close: r.close ? Number(r.close) : null,
      ma20: r.ma20 ? Number(r.ma20) : null,
      ma60: r.ma60 ? Number(r.ma60) : null,
      high52: r.high52 ? Number(r.high52) : null,
      low52: r.low52 ? Number(r.low52) : null,
    });
  }

  // 5) 시계열 생성 (중복 date 제거 - KOSPI 일봉에서 unique date만)
  const seenDates = new Set();
  const history = [];
  for (let i = startIdx; i < allCloses.length; i++) {
    const dateStr = allDates[i];
    if (seenDates.has(dateStr)) continue;
    seenDates.add(dateStr);
    // 그 날짜까지의 KOSPI 종가 slice
    const closesSlice = allCloses.slice(0, i + 1);
    if (closesSlice.length < 130) continue;  // MA120 필요
    const breadth = byDate.get(dateStr) || [];
    const marketData = {
      closes: closesSlice,
      lastClose: closesSlice[closesSlice.length - 1],
      lastDate: dateStr,
    };
    const r = calculateMarketRegime(marketData, breadth);
    history.push({
      date: dateStr,
      score: r.score,
      label: r.label,
      components: {
        trend: r.components.trend.score,
        momentum: r.components.momentum.score,
        breadth: r.components.breadth.score,
        newHighLow: r.components.newHighLow.score,
        volatility: r.components.volatility.score,
      },
    });
  }
  console.log(`history: ${history.length}일치`);

  // 6) JSON 저장
  const outPath = path.resolve('public/data/market-regime-history.json');
  fs.writeFileSync(outPath, JSON.stringify({ history, generatedAt: new Date().toISOString() }, null, 2), 'utf8');
  console.log(`[저장] ${outPath}`);

  // 간단 출력
  const last5 = history.slice(-5).map((h) => `${h.date}: ${h.score} (${h.label})`).join('\n');
  console.log(`\n최근 5일:\n${last5}`);

  await db.close();
})().catch((e) => { console.error('ERR:', e); process.exit(1); });
