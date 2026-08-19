// 실시간 시그널 — Naver Finance polling API
// 사용법: node scripts/fetch-signals.mjs
// 결과: data/signals.json

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const FUND = JSON.parse(
  readFileSync("C:/Users/LG/.minimax/workspace/kospi-dashboard/data/fundamentals.json", "utf-8")
);

const OUT = "C:/Users/LG/.minimax/workspace/kospi-dashboard/data/signals.json";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Referer: "https://finance.naver.com/",
};

const UPPER_LIMIT_THRESHOLD = 29.0; // +29% 이상은 사실상 상한가
const TOP_N_TURNOVER = 30;

// Naver polling API returns fields with comma-formatted strings
// Special: "accumulatedTradingValue" comes as "5조 6,568억" or "516억" — convert to 억원
function _num(x) {
  if (x == null) return 0;
  if (typeof x === "number") return x;
  return Number(String(x).replace(/,/g, "")) || 0;
}

function _parseTradingValue(x) {
  // Returns value in 억원
  if (x == null) return 0;
  if (typeof x === "number") return x / 1e8;
  const s = String(x).replace(/,/g, "").replace(/\s+/g, "");
  // "5조6,568억" or "5조6568억" or "516억" or "1000원"
  let totalEok = 0;
  const joMatch = s.match(/^([\d.]+)조/);
  if (joMatch) totalEok += parseFloat(joMatch[1]) * 10000;
  const eokMatch = s.match(/([\d.]+)억/);
  if (eokMatch) totalEok += parseFloat(eokMatch[1]);
  // If we matched nothing, fall back to raw number (in case API changes)
  if (!joMatch && !eokMatch) {
    return Number(s) || 0;
  }
  return totalEok;
}

async function fetchBatch(codes) {
  // Naver API: comma-separated codes → 한 번에 받기
  const url = `https://polling.finance.naver.com/api/realtime/domestic/stock/${codes.join(",")}`;
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) return [];
  const j = await r.json();
  return (j?.datas || []).map((d) => {
    const cr = _num(d.fluctuationsRatio);
    return {
      code: d.itemCode,
      name: d.stockName,
      closePrice: _num(d.closePrice),
      changeRate: cr,
      changePrice: _num(d.compareToPreviousClosePrice),
      openPrice: _num(d.openPrice),
      highPrice: _num(d.highPrice),
      lowPrice: _num(d.lowPrice),
      volume: _num(d.accumulatedTradingVolume),
      tradingValue: _parseTradingValue(d.accumulatedTradingValue),
      marketStatus: d.marketStatus || d.stockExchangeType?.name || "UNKNOWN",
      isUpperLimit: cr >= UPPER_LIMIT_THRESHOLD,
      isLowerLimit: cr <= -UPPER_LIMIT_THRESHOLD,
    };
  });
}

async function main() {
  const tickers = FUND.map((s) => s.ticker).filter(Boolean);
  console.log(`[signals] ${tickers.length} 종목 시그널 수집 (Naver polling API)`);

  const BATCH = 20; // 한 번에 20개씩
  const all = [];
  for (let i = 0; i < tickers.length; i += BATCH) {
    const batch = tickers.slice(i, i + BATCH);
    try {
      const rows = await fetchBatch(batch);
      all.push(...rows);
      process.stdout.write(`\r  ... ${Math.min(i + BATCH, tickers.length)}/${tickers.length}`);
    } catch (e) {
      console.error(`\n  batch failed: ${e.message}`);
    }
  }
  console.log(`\n  → ${all.length} 종목 응답`);

  // 거래대금 > 0 인 것만
  const valid = all.filter((r) => r.tradingValue > 0);

  // 상한가 / 하한가
  const upperLimit = valid
    .filter((r) => r.isUpperLimit)
    .sort((a, b) => b.changeRate - a.changeRate);

  const lowerLimit = valid
    .filter((r) => r.isLowerLimit)
    .sort((a, b) => a.changeRate - b.changeRate);

  // 거래대금 상위 N
  const topTurnover = [...valid]
    .sort((a, b) => b.tradingValue - a.tradingValue)
    .slice(0, TOP_N_TURNOVER);

  // 등락률 상위
  const top_gainers = [...valid].sort((a, b) => b.changeRate - a.changeRate).slice(0, 20);
  const top_losers = [...valid].sort((a, b) => a.changeRate - b.changeRate).slice(0, 20);

  const result = {
    fetched_at: new Date().toISOString(),
    n_total: all.length,
    n_valid: valid.length,
    market_open: all[0]?.marketStatus === "OPEN",
    upper_limit: upperLimit,
    lower_limit: lowerLimit,
    top_turnover: topTurnover,
    top_gainers,
    top_losers,
  };

  writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(`\n  → ${OUT}`);
  console.log(`     상한가: ${upperLimit.length}, 하한가: ${lowerLimit.length}, 거래대금 top: ${topTurnover.length}`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
