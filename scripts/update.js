'use strict';

// 데이터 갱신 스크립트 (GitHub Actions 전용, 로컬에서도 사용 가능)
// 실행: npm run update
//
// 주요 원칙:
// 1) **증분 fetch**: 가격은 마지막 저장일 +1 부터, 재무는 30일 이상 경과 시에만 갱신
// 2) **경량 연산**: grid search 80개, OLS 가우시안 소거법 직접 구현
// 3) 데이터가 적으면 친절한 메시지 + 부분 데이터로 진행

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

const cfg = require('../src/config');
const { initSchema } = require('../src/db/init');
const db = require('../src/db/connection');
const data = require('../src/data');
const indices = require('../src/data/indices');
const { calculateAll, persistScores } = require('../src/factors');
const scoring = require('../src/scoring');
const { backtest } = require('../src/scoring/backtest');
const { exportOptimizer } = require('../src/scoring/optimizer');

const DATA_DIR = path.join(ROOT, 'public', 'data');
const STOCK_DIR = path.join(DATA_DIR, 'stock');
const TOP_N_SHIPPED = 20;
const HEATMAP_LIMIT = 80;
const STOCK_HISTORY_DAYS = 90;
const FUND_REFRESH_DAYS = 30;          // 재무는 30일 이상 경과 시에만
const FUND_FULL_FETCH_LIMIT = 30;       // 첫 실행 시 신규 종목 30개만 (점진적)

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function nextDay(yyyy_mm_dd) {
  if (!yyyy_mm_dd) return null;
  const d = new Date(yyyy_mm_dd);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function writeJson(name, obj) {
  const p = path.join(DATA_DIR, name);
  // DuckDB BIGINT는 JavaScript BigInt로 옴 → JSON.stringify는 처리 못 함
  // → 재귀적으로 BigInt → Number 변환
  const plain = JSON.stringify(obj, (_k, v) => {
    if (typeof v === 'bigint') return Number(v);
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      const o = {};
      for (const k of Object.keys(v)) o[k] = v[k] instanceof Date ? v[k].toISOString() : v[k];
      return o;
    }
    return v;
  });
  fs.writeFileSync(p, plain);
  console.log(`  → ${name} (${(fs.statSync(p).size / 1024).toFixed(1)}KB)`);
}

async function refreshStocks() {
  let n = 0;
  for (const market of cfg.data.markets) {
    const list = await data.listStocks(market);
    for (const s of list) {
      await db.run(
        `INSERT INTO stocks (code, name, market, sector, industry, listed_shares)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT (code) DO UPDATE SET
           name = EXCLUDED.name, market = EXCLUDED.market,
           sector = COALESCE(EXCLUDED.sector, stocks.sector),
           industry = COALESCE(EXCLUDED.industry, stocks.industry),
           listed_shares = COALESCE(EXCLUDED.listed_shares, stocks.listed_shares),
           updated_at = now()`,
        [s.code, s.name, s.market, s.sector, s.industry, s.listed_shares || null],
      );
      n++;
    }
    await sleep(300);
  }
  return n;
}

// === 증분 가격 fetch ===
async function refreshPricesForAll({ maxDays = null, concurrency = 5 } = {}) {
  const rows = await db.all(`SELECT code FROM stocks WHERE market IN ('KOSPI','KOSDAQ')`);
  let updated = 0, fetched = 0;
  // DB에 기존 일봉이 있는지 확인 (없으면 첫 실행 모드)
  const existingCount = await db.one(`SELECT COUNT(*) AS c FROM daily_prices LIMIT 1`);
  const isInitial = (Number(existingCount?.c) || 0) === 0;
  // maxPages = 1 (60일) 으로 고정 → 100분 → 5~10분으로 단축
  // maxDays 파라미터 있으면 그에 맞춰 페이지 수 조정
  const maxPages = maxDays ? Math.min(Math.ceil(maxDays / 60), 30) : 1;
  if (isInitial) console.log(`     (첫 실행 감지: maxPages=${maxPages}, ${maxPages * 60}일치)`);
  console.log(`     (병렬 ${concurrency}개씩 fetch 시작: ${rows.length} 종목)`);

  // 배치 처리 (concurrency만큼 동시 실행)
  for (let i = 0; i < rows.length; i += concurrency) {
    const batch = rows.slice(i, i + concurrency);
    await Promise.all(batch.map(async ({ code }) => {
      try {
        const last = await db.one(`SELECT MAX(date) AS d FROM daily_prices WHERE code = ?`, [code]);
        const fromDate = nextDay(last?.d ? String(last.d) : null);
        const prices = await data.getDailyPrices(code, { fromDate, maxPages });
        if (prices.length === 0) return;
        for (const p of prices) {
          await db.run(
            `INSERT INTO daily_prices (code, date, open, high, low, close, volume, trading_value, market_cap)
             VALUES (?,?,?,?,?,?,?,?,?)
             ON CONFLICT (code, date) DO NOTHING`,
            [code, String(p.date), p.open, p.high, p.low, p.close, p.volume, p.trading_value, p.market_cap],
          );
        }
        updated += prices.length;
      } catch (e) {
        // quiet log for first run (avoid 4K lines of errors)
      }
    }));
    fetched += batch.length;
    if (fetched % 200 === 0 || fetched === rows.length) {
      console.log(`     ... ${fetched}/${rows.length} 종목, ${updated} 행`);
    }
    // 배치 간 짧은 sleep
    await sleep(isInitial ? 50 : 100);
  }
  console.log(`     → ${fetched}개 종목, ${updated} 행`);
  return updated;
}

// === 증분 재무 fetch (30일 이상 경과 시만) ===
async function refreshFundamentalsForAll({ limit = null } = {}) {
  // limit: 첫 실행 시 일부만 처리 (부하 분산)
  const rows = await db.all(`
    SELECT s.code,
           MAX(f.updated_at) AS last_update
    FROM stocks s
    LEFT JOIN fundamentals f ON f.code = s.code
    WHERE s.market IN ('KOSPI','KOSDAQ')
    GROUP BY s.code
    ${limit ? 'LIMIT ?' : ''}
  `, limit ? [limit] : []);

  const cutoff = new Date(Date.now() - FUND_REFRESH_DAYS * 86400_000).toISOString();
  let updated = 0, skipped = 0;
  for (const { code, last_update } of rows) {
    // 30일 이내 갱신했으면 스킵
    if (last_update && new Date(last_update).toISOString() > cutoff) {
      skipped++;
      continue;
    }
    try {
      const f = await data.getFinance(code);
      if (!f) continue;
      const period = f.period || 'LATEST';
      await db.run(
        `INSERT INTO fundamentals
          (code, period, per, pbr, psr, eps, bps, roe, roa, revenue, operating_profit, net_profit, debt_ratio, dividend_yield)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT (code, period) DO UPDATE SET
           per = EXCLUDED.per, pbr = EXCLUDED.pbr, psr = EXCLUDED.psr,
           eps = EXCLUDED.eps, bps = EXCLUDED.bps, roe = EXCLUDED.roe, roa = EXCLUDED.roa,
           revenue = EXCLUDED.revenue, operating_profit = EXCLUDED.operating_profit,
           net_profit = EXCLUDED.net_profit, debt_ratio = EXCLUDED.debt_ratio,
           dividend_yield = EXCLUDED.dividend_yield, updated_at = now()`,
        [code, period, f.per, f.pbr, f.psr, f.eps, f.bps, f.roe, f.roa,
         f.revenue, f.operating_profit, f.net_profit, f.debt_ratio, f.dividend_yield],
      );
      updated++;
    } catch (e) {
      console.error(`[fund] ${code} 실패:`, e.message);
    }
    await sleep(80);
  }
  console.log(`     → ${updated}개 갱신, ${skipped}개 30일 내 갱신됨 (스킵)`);
  return updated;
}

// === 외인/기관 매매동향 fetch ===
async function refreshInvestorFlowForAll({ limit = null } = {}) {
  // limit: 첫 실행 시 일부만 처리
  const rows = await db.all(`
    SELECT s.code
    FROM stocks s
    WHERE s.market IN ('KOSPI','KOSDAQ')
    ${limit ? 'LIMIT ?' : ''}
  `, limit ? [limit] : []);

  let updated = 0, failed = 0;
  for (const { code } of rows) {
    try {
      const flow = await data.getInvestorFlow(code, { days: 20 });
      if (!flow || flow.length === 0) { failed++; continue; }
      for (const r of flow) {
        await db.run(
          `INSERT INTO investor_flow
            (code, date, close, change, volume, institution_net, foreign_net, foreign_holding_ratio)
           VALUES (?,?,?,?,?,?,?,?)
           ON CONFLICT (code, date) DO UPDATE SET
             close = EXCLUDED.close, change = EXCLUDED.change, volume = EXCLUDED.volume,
             institution_net = EXCLUDED.institution_net, foreign_net = EXCLUDED.foreign_net,
             foreign_holding_ratio = EXCLUDED.foreign_holding_ratio`,
          [code, r.date, r.close, r.change, r.volume, r.institution_net, r.foreign_net, r.foreign_holding_ratio],
        );
      }
      updated++;
    } catch (e) {
      console.error(`[flow] ${code} 실패:`, e.message);
      failed++;
    }
    await sleep(120);
  }
  console.log(`     → ${updated}개 갱신, ${failed}개 실패`);
  return updated;
}

async function refreshSectorsForAll({ limit = 100 } = {}) {
  // sector가 NULL인 종목을 우선 갱신 (점진적)
  const rows = await db.all(`
    SELECT s.code
    FROM stocks s
    WHERE s.market IN ('KOSPI','KOSDAQ')
      AND (s.sector IS NULL OR s.sector = '')
    ORDER BY s.market, s.code
    LIMIT ?
  `, [limit]);

  if (rows.length === 0) {
    console.log('     → 갱신할 sector 없음 (전체 완료)');
    return 0;
  }

  let updated = 0, failed = 0;
  for (const { code } of rows) {
    try {
      const r = await data.getStockSector(code);
      if (r.sector) {
        await db.run('UPDATE stocks SET sector = ? WHERE code = ?', [r.sector, code]);
        updated++;
      } else {
        failed++;
      }
    } catch (e) {
      console.error(`[sector] ${code} 실패:`, e.message);
      failed++;
    }
    await sleep(200);
  }
  console.log(`     → ${updated}개 sector 갱신, ${failed}개 실패/없음`);
  return updated;
}

// DuckDB의 {days:N} 또는 {micros:N} 형태 날짜를 ISO string으로 변환
function duckDateToISO(v) {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  if (typeof v === 'object') {
    if (v.days !== undefined) {
      return new Date(Date.UTC(1970, 0, 1) + v.days * 86400000).toISOString().slice(0, 10);
    }
    if (v.micros !== undefined) {
      return new Date(Math.floor(v.micros / 1000)).toISOString().slice(0, 10);
    }
  }
  return String(v);
}

async function exportStatic() {
  console.log('[export] 정적 JSON 생성...');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(STOCK_DIR, { recursive: true });

  const excludeKosdaq = process.env.EXCLUDE_KOSDAQ === '1';

  // 메타
  const stats = await db.one(`
    SELECT
      (SELECT COUNT(*) FROM stocks WHERE market IN ('KOSPI','KOSDAQ')) AS stock_count,
      (SELECT COUNT(DISTINCT sector) FROM stocks WHERE sector IS NOT NULL) AS sector_count,
      (SELECT COUNT(DISTINCT date) FROM factor_scores) AS score_days,
      (SELECT MAX(date) FROM daily_prices) AS last_price_date,
      (SELECT MAX(date) FROM factor_scores) AS last_score_date,
      (SELECT MAX(run_at) FROM update_log) AS last_update
  `);
  const markets = await db.all(`SELECT DISTINCT market FROM stocks ORDER BY market`);
  const sectors = await db.all(`SELECT DISTINCT sector FROM stocks WHERE sector IS NOT NULL ORDER BY sector`);
  const metaObj = {
    stock_count: Number(stats.stock_count) || 0,
    sector_count: Number(stats.sector_count) || 0,
    score_days: Number(stats.score_days) || 0,
    last_price_date: duckDateToISO(stats.last_price_date),
    last_score_date: duckDateToISO(stats.last_score_date),
    last_update: stats.last_update ? new Date(stats.last_update).toISOString() : null,
    markets: markets.map((m) => m.market),
    sectors: sectors.map((s) => s.sector),
    exclude_kosdaq: excludeKosdaq,
    as_of: duckDateToISO(stats.last_price_date) || new Date().toISOString().slice(0, 10),
  };
  writeJson('meta.json', metaObj);

  // 지수 (KOSPI / KOSDAQ / KOSPI200)
  try {
    const idx = await indices.getAllIndices();
    // 각 지수의 history가 비어 있으면 desktop fallback 다시 시도
    for (let i = 0; i < idx.length; i++) {
      if (!idx[i].history || idx[i].history.length < 5) {
        console.log(`[export] ${idx[i].market} history 빈약, desktop fallback 재시도...`);
        const desktop = await indices.getIndexDesktopFull(idx[i].market, { historyDays: 90 });
        if (desktop) idx[i] = desktop;
      }
    }
    writeJson('indices.json', idx);
  } catch (e) {
    console.error('[export] 지수 데이터 실패:', e.message);
    writeJson('indices.json', []);
  }

  // 7팩터 점수 (메모리 캐시)
  const { rows: allFactors, stats: factorStats } = await calculateAll(undefined, { excludeKosdaq });
  const factorMap = new Map(allFactors.map((r) => [r.code, r]));

  // ★ 거래정지/거래량0/KOSDAQ 제외 옵션 = 메인 대시보드에서 제외
  const excludedStatuses = new Set(['halt', 'zero_volume']);
  if (excludeKosdaq) excludedStatuses.add('excluded_kosdaq');
  const filteredTop = allFactors
    .filter((r) => !excludedStatuses.has(r.status) && r.total_score > 0)
    .sort((a, b) => b.total_score - a.total_score);

  // 메타에 통계 추가
  metaObj.factor_stats = factorStats;
  metaObj.excluded_count = factorStats.halt + factorStats.zeroVolume + (excludeKosdaq ? factorStats.kosdaq : 0);
  fs.writeFileSync(
    path.join(DATA_DIR, 'meta.json'),
    JSON.stringify(metaObj, (_k, v) => {
      if (typeof v === 'bigint') return Number(v);
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        const o = {};
        for (const k of Object.keys(v)) o[k] = v[k] instanceof Date ? v[k].toISOString() : v[k];
        return o;
      }
      return v;
    })
  );

  // TOP 20 (거래정지/거래량0/KOSDAQ 제외 후)
  const top = filteredTop.slice(0, TOP_N_SHIPPED).map((r, i) => {
    const stock = r.stock || {};
    return {
      rank: i + 1,
      code: r.code,
      name: stock.name || '',
      market: r.market,
      sector: stock.sector || '',
      industry: stock.industry || '',
      value_score: r.value_score,
      momentum_score: r.momentum_score,
      quality_score: r.quality_score,
      volatility_score: r.volatility_score,
      growth_score: r.growth_score,
      liquidity_score: r.liquidity_score,
      supply_score: r.supply_score,
      total_score: r.total_score,
      status: r.status,
      grade: scoring.gradeFor(r.total_score),
    };
  });

  // 종목명/시장이 factor_scores에는 없으므로 stocks 테이블에서 join
  if (top.length > 0) {
    const codes = top.map((r) => r.code);
    const placeholders = codes.map(() => '?').join(',');
    const stockRows = await db.all(
      `SELECT code, name, market, sector, industry FROM stocks WHERE code IN (${placeholders})`,
      codes
    );
    const stockMap = new Map(stockRows.map((s) => [s.code, s]));
    for (const t of top) {
      const s = stockMap.get(t.code) || {};
      t.name = s.name || t.name;
      t.market = s.market || t.market;
      t.sector = s.sector || t.sector;
      t.industry = s.industry || t.industry;
    }
  }
  writeJson('top.json', top);

  // 전체 (all.json) — 거래정지/거래량0만 제외 (KOSDAQ은 메타에 따라)
  const excludedAll = new Set(['halt', 'zero_volume']);
  const allRowsRaw = allFactors
    .filter((r) => !excludedAll.has(r.status) && r.total_score > 0)
    .sort((a, b) => b.total_score - a.total_score);
  // 종목명 join
  if (allRowsRaw.length > 0) {
    const codes = allRowsRaw.map((r) => r.code);
    const placeholders = codes.map(() => '?').join(',');
    const stockRows = await db.all(
      `SELECT code, name, market, sector, industry FROM stocks WHERE code IN (${placeholders})`,
      codes
    );
    const stockMap = new Map(stockRows.map((s) => [s.code, s]));
    for (const r of allRowsRaw) {
      const s = stockMap.get(r.code) || {};
      r.name = s.name || '';
      r.market = s.market;
      r.sector = s.sector || '';
      r.industry = s.industry || '';
      r.grade = scoring.gradeFor(r.total_score);
    }
  }
  writeJson('all.json', allRowsRaw);

  // 섹터
  const sectorsData = await scoring.getSectorScores();
  const marketsData = await scoring.getMarketScores();
  writeJson('sectors.json', { sectors: sectorsData, markets: marketsData });

  // 히트맵
  const heatmap = await scoring.getHeatmap({ limit: HEATMAP_LIMIT });
  writeJson('heatmap.json', heatmap);

  // 상관관계
  const corr = await scoring.getFactorCorrelation();
  writeJson('correlation.json', { keys: corr.keys, matrix: corr.matrix });

  // 분포 (제외 종목 빼고)
  const distScores = allRowsRaw.map((r) => r.total_score);
  writeJson('distribution.json', { scores: distScores });

  // 로그
  const logs = await db.all(`SELECT * FROM update_log ORDER BY id DESC LIMIT 10`);
  writeJson('log.json', logs);

  // 가중치 최적화
  try {
    console.log('[export] 가중치 최적화...');
    const opt = await exportOptimizer();
    writeJson('optimizer.json', opt);
  } catch (e) {
    console.error('[export] optimizer 실패:', e.message);
    writeJson('optimizer.json', { ok: false, error: e.message });
  }

  // 백테스트 (4개 차트 + KOSPI)
  try {
    console.log('[export] 백테스트 (4개 차트)...');
    const bt = await backtest({ topN: 20, lookbackMonths: 24 });
    writeJson('backtest.json', bt);
  } catch (e) {
    console.error('[export] backtest 실패:', e.message);
    writeJson('backtest.json', { ok: false, error: e.message });
  }

  // 종목별 상세 (top + 일부 거래정지 후보)
  console.log('[export] 종목별 상세 JSON 생성...');
  const technical = require('../src/scoring/technical');
  const stockList = await db.all(`SELECT code FROM stocks WHERE market IN ('KOSPI','KOSDAQ')`);
  for (const { code } of stockList) {
    const stock = await db.one(`SELECT * FROM stocks WHERE code = ?`, [code]);
    const score = await db.one(`
      SELECT * FROM factor_scores
      WHERE code = ? AND date = (SELECT MAX(date) FROM factor_scores WHERE code = ?)`, [code, code]);
    const fund = await db.all(`SELECT * FROM fundamentals WHERE code = ? ORDER BY period DESC LIMIT 4`, [code]);
    const prices = await db.all(`
      SELECT date, close, volume FROM daily_prices WHERE code = ?
      ORDER BY date DESC LIMIT ?`, [code, STOCK_HISTORY_DAYS]);
    // 외인/기관 매매 (최근 20일)
    const flow = await db.all(`
      SELECT date, close, change, volume, institution_net, foreign_net, foreign_holding_ratio
      FROM investor_flow WHERE code = ?
      ORDER BY date DESC LIMIT 20`, [code]);
    // 기술분석 (MA, RSI, MACD, BB)
    const tech = technical.analyze(prices);
    // 팩터 기여도 (weights × score, %)
    const weights = cfg.factors.weights;
    const total = score?.total_score || 0;
    let contributions = null;
    // 7팩터 캐시에서 liquidity/supply 가져오기
    const f7 = factorMap.get(code) || {};
    if (score) {
      const parts = {
        value: (Number(score.value_score) || 0) * (weights.value || 0),
        momentum: (Number(score.momentum_score) || 0) * (weights.momentum || 0),
        quality: (Number(score.quality_score) || 0) * (weights.quality || 0),
        volatility: (Number(score.volatility_score) || 0) * (weights.volatility || 0),
        growth: (Number(score.growth_score) || 0) * (weights.growth || 0),
        liquidity: (Number(f7.liquidity_score) || 0) * (weights.liquidity || 0),
        supply: (Number(f7.supply_score) || 0) * (weights.supply || 0),
      };
      const sumP = parts.value + parts.momentum + parts.quality + parts.volatility + parts.growth + parts.liquidity + parts.supply;
      contributions = sumP > 0 ? {
        value: Math.round(parts.value / sumP * 100),
        momentum: Math.round(parts.momentum / sumP * 100),
        quality: Math.round(parts.quality / sumP * 100),
        volatility: Math.round(parts.volatility / sumP * 100),
        growth: Math.round(parts.growth / sumP * 100),
        liquidity: Math.round(parts.liquidity / sumP * 100),
        supply: Math.round(parts.supply / sumP * 100),
      } : null;
    }
    const detail = {
      stock,
      score: score ? { ...score, grade: scoring.gradeFor(total), liquidity_score: f7.liquidity_score, supply_score: f7.supply_score, status: f7.status } : null,
      contributions,
      weights,
      fundamentals: fund,
      prices,
      investor_flow: flow,
      technical: tech.summary,
      technical_series: tech.indicators,
    };
    fs.writeFileSync(path.join(STOCK_DIR, `${code}.json`), JSON.stringify(detail, (_k, v) => typeof v === 'bigint' ? Number(v) : v));
  }
  console.log(`  → stock/*.json (${stockList.length}개)`);
}

(async () => {
  const t0 = Date.now();
  const exportOnly = process.env.EXPORT_ONLY === '1';
  const excludeKosdaq = process.env.EXCLUDE_KOSDAQ === '1';
  const isFirst = !fs.existsSync(path.join(ROOT, 'data', 'quant.db'));
  console.log(`[update] 시작 (모드: ${exportOnly ? 'EXPORT_ONLY' : isFirst ? 'FIRST (전체)' : 'INCREMENTAL'}${excludeKosdaq ? ', KOSDAQ 제외' : ''})`);

  await initSchema();

  let stocksN = 0, pricesN = 0, fundN = 0, flowN = 0, sectorN = 0;
  try {
    if (exportOnly) {
      // DB는 이미 채워져 있고, 점수 재계산 + JSON export만
      console.log('[update] EXPORT_ONLY: 점수 재계산 + JSON export...');
      const { rows } = await calculateAll(undefined, { excludeKosdaq });
      console.log(`     → ${rows.length}개 점수`);
      await exportStatic();
      await db.close();
      console.log(`[update] EXPORT_ONLY 완료. ${(Date.now() - t0) / 1000}s`);
      process.exit(0);
    }
    if (isFirst) {
      console.log('[update] 1/5 종목 목록...');
      stocksN = await refreshStocks();
      console.log(`     → ${stocksN}개`);

      console.log('[update] 2/5 일봉 (전체 첫 fetch)...');
      pricesN = await refreshPricesForAll();
      console.log(`     → ${pricesN} 행`);

      console.log('[update] 3/5 재무 (첫 fetch: 일부만 — 점진적)...');
      fundN = await refreshFundamentalsForAll({ limit: FUND_FULL_FETCH_LIMIT });
      console.log(`     → ${fundN} 행`);

      console.log('[update] 4/5 외인/기관 매매 (TOP 종목만 — 점진적)...');
      // 첫 실행: TOP 50 종목만 (이후 실행에서 계속 채움)
      flowN = await refreshInvestorFlowForAll({ limit: 50 });
      console.log(`     → ${flowN} 행`);

      console.log('[update] 4.5/5 섹터 분류 (TOP 100 — 점진적)...');
      sectorN = await refreshSectorsForAll({ limit: 100 });
      console.log(`     → ${sectorN}개`);

      console.log('[update] 5/5 나머지 재무/수급 (백그라운드, 다음 실행에서 계속)...');
    } else {
      console.log('[update] 1/5 종목 목록 갱신...');
      stocksN = await refreshStocks();
      console.log(`     → ${stocksN}개`);

      console.log('[update] 2/5 일봉 (증분)...');
      pricesN = await refreshPricesForAll();
      console.log(`     → ${pricesN} 행`);

      console.log('[update] 3/5 재무 (30일 경과분만)...');
      fundN = await refreshFundamentalsForAll();
      console.log(`     → ${fundN} 행`);

      console.log('[update] 4/5 외인/기관 매매 (TOP 50)...');
      flowN = await refreshInvestorFlowForAll({ limit: 50 });
      console.log(`     → ${flowN} 행`);

      console.log('[update] 4.5/5 섹터 분류 (TOP 100 — 점진적)...');
      sectorN = await refreshSectorsForAll({ limit: 100 });
      console.log(`     → ${sectorN}개`);
    }

    console.log('[update] 점수 계산...');
    const { rows } = await calculateAll(undefined, { excludeKosdaq });
    const scoreN = await persistScores(rows);
    console.log(`     → ${scoreN}개 점수`);

    await db.run(
      `INSERT INTO update_log (status, message, stocks_updated, duration_ms)
       VALUES ('ok', ?, ?, ?)`,
      [`stocks=${stocksN} prices=${pricesN} fund=${fundN} flow=${flowN} sector=${sectorN} scores=${scoreN}`,
       stocksN, Date.now() - t0],
    );

    console.log('[update] JSON 출력...');
    await exportStatic();

    const ms = Date.now() - t0;
    console.log(`[update] 완료. ${(ms / 1000).toFixed(1)}s`);

    await db.close();
    process.exit(0);
  } catch (e) {
    console.error('=========================================');
    console.error('[update] 실패:', e);
    console.error('  message:', e?.message);
    console.error('  stack:', e?.stack);
    console.error('=========================================');
    try {
      await db.run(
        `INSERT INTO update_log (status, message) VALUES ('error', ?)`,
        [String(e.message || e).slice(0, 500)],
      );
    } catch (_) { /* ignore */ }
    process.exit(1);
  }
})();
