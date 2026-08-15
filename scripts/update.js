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
const { backtest, backtestFromDailyPrices } = require('../src/scoring/backtest');
const { exportOptimizer } = require('../src/scoring/optimizer');

// === 애널리스트 전망 (mock - 점수 기반 추정) ===
function generateAnalystOutlook(row) {
  // 7팩터 종합 + 모멘텀/퀄리티 기반으로 등급 결정
  const t = Number(row.total_score) || 0;
  const mom = Number(row.momentum_score) || 0;
  const qual = Number(row.quality_score) || 0;
  const val = Number(row.value_score) || 0;
  const grow = Number(row.growth_score) || 0;
  const vol = Number(row.volatility_score) || 0;
  const liq = Number(row.liquidity_score) || 0;
  const sup = Number(row.supply_score) || 0;

  let rating = '중립';
  let targetUpside = 0;
  if (t >= 80) { rating = 'Strong Buy'; targetUpside = 0.30; }
  else if (t >= 70) { rating = 'Buy'; targetUpside = 0.20; }
  else if (t >= 60) { rating = 'Accumulate'; targetUpside = 0.12; }
  else if (t >= 50) { rating = 'Hold'; targetUpside = 0.05; }
  else if (t >= 40) { rating = 'Reduce'; targetUpside = -0.05; }
  else { rating = 'Sell'; targetUpside = -0.15; }

  // 모멘텀 강하면 upside 상향
  if (mom >= 80) targetUpside += 0.05;
  // 퀄리티 약하면 downside 가중
  if (qual < 40) targetUpside -= 0.05;
  // 가치 매력 (낮은 PER)면 upside 가산
  if (val >= 80) targetUpside += 0.03;
  // 성장 강하면 upside 가산
  if (grow >= 80) targetUpside += 0.04;
  // 유동/수급 양호하면 안정성 가산
  if (liq >= 70 && sup >= 70) targetUpside += 0.02;

  const targetPrice = row.close ? Math.round(row.close * (1 + targetUpside)) : null;
  const upsidePct = targetUpside * 100;

  // === 자세한 코멘트 (2~3 문장) ===
  const strengths = [];
  if (mom >= 80) strengths.push('12개월 모멘텀이 백분위 80 이상으로 매우 강합니다');
  else if (mom >= 65) strengths.push('단기 모멘텀이 우호적입니다');
  if (val >= 80) strengths.push('PER·PBR 기준으로 저평가 구간에 위치합니다');
  else if (val >= 60) strengths.push('밸류에이션이 적정 수준입니다');
  if (qual >= 80) strengths.push('ROE·재무안정성 등 퀄리티 지표가 우수합니다');
  else if (qual >= 60) strengths.push('퀄리티는 평균 이상입니다');
  if (grow >= 80) strengths.push('매출·이익 성장률이 업종 상위권입니다');
  if (liq >= 70) strengths.push('일평균 거래대금이 충분해 유동성 리스크가 낮습니다');
  if (sup >= 70) strengths.push('외인·기관의 순매수세가 확인됩니다');

  const weaknesses = [];
  if (mom < 30) weaknesses.push('모멘텀이 부진합니다');
  if (val < 30) weaknesses.push('밸류에이션 부담이 있습니다');
  if (qual < 30) weaknesses.push('퀄리티 우려(부채·수익성)가 있습니다');
  if (grow < 30) weaknesses.push('성장률이 정체 또는 역성장입니다');
  if (vol < 30) weaknesses.push('변동성이 커서 단기 조정 가능성이 있습니다');

  let comment = '';
  if (rating === 'Strong Buy') {
    comment = '7팩터 종합 최상위권입니다. ';
    comment += strengths.length > 0 ? strengths.slice(0, 3).join(', ') + '. ' : '주요 팩터가 고르게 강세를 보입니다. ';
    comment += weaknesses.length > 0 ? '다만 ' + weaknesses[0] + '은 모니터링 필요.' : '단기 모멘텀과 펀더멘털이 모두 양호합니다.';
  } else if (rating === 'Buy') {
    comment = '종합 우량 등급입니다. ';
    comment += strengths.length > 0 ? strengths[0] + '. ' : '';
    comment += '단기 모멘텀 강세로 매수 적기이나, 분할 매수 권장.';
  } else if (rating === 'Accumulate') {
    comment = '안정적 우량주입니다. ';
    comment += strengths.length > 0 ? strengths.slice(0, 2).join(', ') + '. ' : '주가 안정적. ';
    comment += weaknesses.length > 0 ? weaknesses[0] + '은 약점.' : '';
    comment += ' 분할 매수로 포지션 구축 추천.';
  } else if (rating === 'Hold') {
    comment = '중립적입니다. ';
    comment += strengths.length > 0 ? strengths[0] + '. ' : '';
    comment += weaknesses.length > 0 ? weaknesses[0] + '.' : '';
    comment += ' 현 가격 유지 관망, 추가 신호 대기.';
  } else if (rating === 'Reduce') {
    comment = '일부 팩터 약세입니다. ';
    comment += weaknesses.length > 0 ? weaknesses.slice(0, 2).join(', ') + '. ' : '복합 약세. ';
    comment += '비중 축소 검토.';
  } else {
    comment = '복합 약세입니다. ';
    comment += weaknesses.length > 0 ? weaknesses.slice(0, 3).join(', ') + '. ' : '';
    comment += '회피 권장.';
  }

  // 1줄 요약
  const oneLine = (() => {
    if (rating === 'Strong Buy') return '🚀 Strong Buy: 핵심 보유 후보, 모멘텀+퀄리티 우수';
    if (rating === 'Buy') return '✅ Buy: 종합 우량, 단기 모멘텀 강세';
    if (rating === 'Accumulate') return '👍 Accumulate: 안정 우량, 분할 매수 적기';
    if (rating === 'Hold') return '⚖️ Hold: 중립, 추가 신호 대기';
    if (rating === 'Reduce') return '⚠️ Reduce: 일부 약세, 비중 축소';
    return '🚨 Sell: 복합 약세, 회피';
  })();

  return {
    rating,
    targetPrice,
    upsidePct: Math.round(upsidePct * 10) / 10,
    comment,
    oneLine,
  };
}

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
  // PER/PBR이 NULL인 종목은 항상 다시 fetch (이전 시도에서 실패했을 수 있음)
  const rows = await db.all(`
    SELECT s.code,
           MAX(f.updated_at) AS last_update,
           MAX(f.per) AS per,
           MAX(f.pbr) AS pbr
    FROM stocks s
    LEFT JOIN fundamentals f ON f.code = s.code
    WHERE s.market IN ('KOSPI','KOSDAQ')
    GROUP BY s.code
    ${limit ? 'LIMIT ?' : ''}
  `, limit ? [limit] : []);

  const cutoff = new Date(Date.now() - FUND_REFRESH_DAYS * 86400_000).toISOString();
  let updated = 0, skipped = 0;
  for (const { code, last_update, per, pbr } of rows) {
    // 30일 이내 + 이미 PER/PBR이 있으면 스킵
    const hasFund = (per != null || pbr != null);
    if (last_update && hasFund && new Date(last_update).toISOString() > cutoff) {
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

  // ★ KOSDAQ 별도 데이터 (별도 페이지용, KOSDAQ만 포함)
  const kosdaqTop = allFactors
    .filter((r) => r.market === 'KOSDAQ' && r.total_score > 0 && r.status !== 'halt' && r.status !== 'zero_volume')
    .sort((a, b) => b.total_score - a.total_score)
    .slice(0, 50);

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

  // TOP 20 (거래정지/거래량0/KOSDAQ 제외 + ETF/레버리지/인버스/SPAC/우선주 제외)
  // isExcludedProduct은 factors/index.js에서 import
  const { isExcludedProduct } = require('../src/factors');
  let top = filteredTop
    .filter((r) => !isExcludedProduct(r.name))
    .slice(0, TOP_N_SHIPPED)
    .map((r, i) => {
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

  // ★ KOSDAQ 별도 TOP 50 (KOSDAQ 페이지용, ETF/우선주/액티브/스팩/레버리지/인버스 제외)
  const kosdaqJson = kosdaqTop
    .filter((r) => !isExcludedProduct(r.name))
    .map((r, i) => {
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
  writeJson('kosdaq-top.json', kosdaqJson);

  // ★ 팩터별 TOP 20 (모멘텀/가치/퀄리티/저변동/성장)
  const factorTopJson = (key) => allFactors
    .filter((r) => !isExcludedProduct(r.name) && r.total_score > 0 && r.status !== 'halt' && r.status !== 'zero_volume')
    .sort((a, b) => (Number(b[key]) || 0) - (Number(a[key]) || 0))
    .slice(0, 20)
    .map((r, i) => {
      const stock = r.stock || {};
      return {
        rank: i + 1,
        code: r.code,
        name: stock.name || '',
        market: r.market,
        sector: stock.sector || '',
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
  writeJson('mom-top.json', factorTopJson('momentum_score'));
  writeJson('value-top.json', factorTopJson('value_score'));
  writeJson('quality-top.json', factorTopJson('quality_score'));
  writeJson('lowvol-top.json', factorTopJson('volatility_score'));

  // 종목 상세 join (name/market_cap/sector + 외인+기관 5일 + 애널리스트 mock)
  if (top.length > 0) {
    const codes = top.map((r) => r.code);
    const placeholders = codes.map(() => '?').join(',');
    const stockRows = await db.all(
      `SELECT code, name, market, sector, industry, listed_shares FROM stocks WHERE code IN (${placeholders})`,
      codes
    );
    const stockMap = new Map(stockRows.map((s) => [s.code, s]));

    // 시총 계산용 close + 외인+기관 5일
    const closeRows = await db.all(
      `SELECT code, close FROM daily_prices dp
       WHERE (code, date) IN (SELECT code, MAX(date) FROM daily_prices GROUP BY code)
         AND code IN (${placeholders})`,
      codes
    );
    const closeMap = new Map(closeRows.map((c) => [c.code, Number(c.close)]));

    const supplyRows = await db.all(`
      WITH ranked AS (
        SELECT code, foreign_net, institution_net, ROW_NUMBER() OVER (PARTITION BY code ORDER BY date DESC) AS rn
        FROM investor_flow
        WHERE code IN (${placeholders})
      )
      SELECT code,
             SUM(foreign_net) FILTER (WHERE rn <= 5) AS foreign_5d,
             SUM(institution_net) FILTER (WHERE rn <= 5) AS inst_5d
      FROM ranked GROUP BY code
    `, codes);
    const supplyMap = new Map(supplyRows.map((s) => [s.code, s]));

    for (const t of top) {
      const s = stockMap.get(t.code) || {};
      const close = closeMap.get(t.code) || 0;
      const shares = Number(s.listed_shares) || 0;
      const marketCap = close * shares;
      const sup = supplyMap.get(t.code) || {};
      t.name = s.name || t.name;
      t.market = s.market || t.market;
      t.sector = s.sector || t.sector;
      t.industry = s.industry || t.industry;
      t.close = close;
      t.listed_shares = shares;
      t.market_cap = marketCap;
      t.foreign_5d = Number(sup.foreign_5d) || 0;     // 단위: 주
      t.inst_5d = Number(sup.inst_5d) || 0;          // 단위: 주
      t.foreign_5d_amt = (t.foreign_5d) * close;    // 단위: 원
      t.inst_5d_amt = (t.inst_5d) * close;
      // 애널리스트 전망 (mock - 점수 기반 추정)
      t.analyst = generateAnalystOutlook(t);
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

  // 섹터 통계 (DB에서 직접 계산)
  try {
    const sectorRows = await db.all(`
      SELECT
        COALESCE(NULLIF(s.sector, ''), '미분류') AS sector,
        s.market,
        COUNT(*) AS count,
        AVG(fs.total_score) AS avg_total,
        AVG(fs.value_score) AS avg_value,
        AVG(fs.momentum_score) AS avg_momentum,
        AVG(fs.quality_score) AS avg_quality,
        AVG(fs.volatility_score) AS avg_volatility,
        AVG(fs.growth_score) AS avg_growth,
        AVG(fs.liquidity_score) AS avg_liquidity,
        AVG(fs.supply_score) AS avg_supply
      FROM factor_scores fs
      JOIN stocks s ON s.code = fs.code
      WHERE fs.date = (SELECT MAX(date) FROM factor_scores) AND fs.total_score > 0
      GROUP BY s.sector, s.market
      HAVING COUNT(*) >= 3
      ORDER BY avg_total DESC
    `);
    const sectors = sectorRows.map((r) => ({
      sector: r.sector,
      market: r.market,
      count: Number(r.count) || 0,
      avg_total: Number(r.avg_total) || 0,
      avg_value: Number(r.avg_value) || 0,
      avg_momentum: Number(r.avg_momentum) || 0,
      avg_quality: Number(r.avg_quality) || 0,
      avg_volatility: Number(r.avg_volatility) || 0,
      avg_growth: Number(r.avg_growth) || 0,
      avg_liquidity: Number(r.avg_liquidity) || 0,
      avg_supply: Number(r.avg_supply) || 0,
    }));

    const marketRows = await db.all(`
      SELECT s.market,
             COUNT(*) AS count,
             AVG(fs.total_score) AS avg_total
      FROM factor_scores fs
      JOIN stocks s ON s.code = fs.code
      WHERE fs.date = (SELECT MAX(date) FROM factor_scores) AND fs.total_score > 0
      GROUP BY s.market
    `);
    const markets = marketRows.map((r) => ({
      market: r.market,
      count: Number(r.count) || 0,
      avg_total: Number(r.avg_total) || 0,
    }));
    writeJson('sectors.json', { sectors, markets });
  } catch (e) {
    console.error('[export] sectors 실패:', e.message);
    writeJson('sectors.json', { sectors: [], markets: [] });
  }

  // 히트맵 (DB에서 직접 계산 - close × score)
  // listed_shares는 Naver API 미제공 → 20일 평균 거래대금으로 size 근사
  try {
    const heatmapRows = await db.all(`
      SELECT s.code, s.name, s.market, s.sector, s.industry,
             fs.total_score,
             fs.value_score, fs.momentum_score, fs.quality_score,
             fs.volatility_score, fs.growth_score, fs.liquidity_score, fs.supply_score,
             (SELECT close FROM daily_prices WHERE code = s.code ORDER BY date DESC LIMIT 1) AS close_now,
             (SELECT AVG(turnover) FROM (
                SELECT volume * close AS turnover FROM daily_prices
                WHERE code = s.code ORDER BY date DESC LIMIT 20
             )) AS turnover_20d
      FROM factor_scores fs
      JOIN stocks s ON s.code = fs.code
      WHERE fs.date = (SELECT MAX(date) FROM factor_scores)
        AND fs.total_score > 0 AND s.market = 'KOSPI'
        AND (SELECT volume FROM daily_prices WHERE code = s.code ORDER BY date DESC LIMIT 1) > 0
      ORDER BY fs.total_score DESC
      LIMIT ?
    `, [HEATMAP_LIMIT]);
    const heatmap = heatmapRows.map((r) => {
      const close = Number(r.close_now) || 0;
      const turnover = Number(r.turnover_20d) || 0;
      // 20일 평균 거래대금으로 size 근사 (close × volume)
      const tradingValue = turnover > 0 ? turnover : 0;
      return {
        code: String(r.code),
        name: r.name,
        market: r.market,
        sector: r.sector || '',
        industry: r.industry || '',
        total_score: Number(r.total_score) || 0,
        close: close,
        volume: Math.round(turnover / (close || 1)), // 근사치
        trading_value: tradingValue,
        market_cap: tradingValue, // 호환성 (실제 시총은 아님, 20일 평균 거래대금)
        value_score: Number(r.value_score) || 0,
        momentum_score: Number(r.momentum_score) || 0,
        quality_score: Number(r.quality_score) || 0,
        volatility_score: Number(r.volatility_score) || 0,
        growth_score: Number(r.growth_score) || 0,
        liquidity_score: Number(r.liquidity_score) || 0,
        supply_score: Number(r.supply_score) || 0,
      };
    }).filter((h) => h.close > 0);
    writeJson('heatmap.json', heatmap);
    console.log(`     → heatmap ${heatmap.length}개 (KOSPI, ETF/레버리지/인버스/SPAC 제외, size=거래대금)`);
  } catch (e) {
    console.error('[export] heatmap 실패:', e.message);
    writeJson('heatmap.json', []);
  }

  // 상관관계 (in-memory 계산 - DB factor_scores는 liquidity/supply null + 5팩터만 저장되므로)
  // 7팩터 전체의 실제 상관을 allFactors에서 직접 계산
  try {
    const FACTOR_KEYS = ['value_score', 'momentum_score', 'quality_score', 'volatility_score', 'growth_score', 'liquidity_score', 'supply_score'];
    // status !== halt/zero_volume 인 정상 종목만 (메인 점수 분포와 일치)
    const validRows = allFactors.filter((r) =>
      r.status !== 'halt' && r.status !== 'zero_volume' &&
      Number(r.total_score) > 0
    );
    // 각 팩터의 평균/표준편차
    const stats = {};
    for (const k of FACTOR_KEYS) {
      const vals = validRows.map((r) => Number(r[k]) || 0);
      const mean = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
      const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length || 1);
      stats[k] = { mean, std: Math.sqrt(variance) };
    }
    // Pearson 상관계수 매트릭스
    const matrix = {};
    for (const a of FACTOR_KEYS) {
      matrix[a] = {};
      for (const b of FACTOR_KEYS) {
        if (a === b) { matrix[a][b] = 1; continue; }
        const sa = stats[a].std, sb = stats[b].std;
        if (sa === 0 || sb === 0) { matrix[a][b] = 0; continue; }
        let num = 0;
        for (const r of validRows) {
          num += ((Number(r[a]) || 0) - stats[a].mean) * ((Number(r[b]) || 0) - stats[b].mean);
        }
        matrix[a][b] = Number((num / (validRows.length * sa * sb)).toFixed(3));
      }
    }
    // 상관 높은 페어 추출 (|r| >= 0.4, 대각 제외)
    const highPairs = [];
    for (let i = 0; i < FACTOR_KEYS.length; i++) {
      for (let j = i + 1; j < FACTOR_KEYS.length; j++) {
        const a = FACTOR_KEYS[i], b = FACTOR_KEYS[j];
        const r = matrix[a][b];
        if (Math.abs(r) >= 0.4) highPairs.push({ a, b, r });
      }
    }
    highPairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
    writeJson('correlation.json', {
      keys: FACTOR_KEYS,
      matrix,
      stats,
      n: validRows.length,
      highPairs: highPairs.slice(0, 10),
      asOf: new Date().toISOString().slice(0, 10),
    });
    console.log(`     → correlation ${validRows.length}개, highPairs ${highPairs.length}개`);
  } catch (e) {
    console.error('[export] correlation 실패:', e.message);
    writeJson('correlation.json', { keys: [], matrix: {} });
  }

  // === 신규: 급등/급락 TOP 10 (±29.99% cap, 레버리지/ETF/인버스/SPAC 제외) ===
  try {
    const movers = await db.all(`
      WITH latest AS (
        SELECT code, MAX(date) AS d, AVG(close) AS close_now
        FROM daily_prices
        GROUP BY code
      ),
      prev AS (
        SELECT l.code,
               (SELECT close FROM daily_prices WHERE code = l.code AND date < l.d ORDER BY date DESC LIMIT 1) AS close_prev,
               l.d AS latest_d
        FROM latest l
      )
      SELECT s.code, s.name, s.market, s.sector,
             fs.total_score,
             ((p.latest_d, p.close_prev, l.close_now, s.name) IS NOT NULL) AS _ok,
             CASE WHEN p.close_prev > 0 THEN ((l.close_now - p.close_prev) / p.close_prev * 100) ELSE NULL END AS change_pct
      FROM latest l
      JOIN prev p ON p.code = l.code
      JOIN stocks s ON s.code = l.code
      LEFT JOIN factor_scores fs ON fs.code = l.code AND fs.date = (SELECT MAX(date) FROM factor_scores)
      WHERE s.market = 'KOSPI' AND p.close_prev > 0
        AND p.close_prev != l.close_now
        AND ((l.close_now - p.close_prev) / p.close_prev * 100) BETWEEN -29.99 AND 29.99
        AND (
          s.name NOT LIKE '%KODEX%' AND s.name NOT LIKE '%TIGER%' AND s.name NOT LIKE '%KBSTAR%'
          AND s.name NOT LIKE '%ARIRANG%' AND s.name NOT LIKE '%KINDEX%' AND s.name NOT LIKE '%SOL %'
          AND s.name NOT LIKE '%ACE %' AND s.name NOT LIKE '%RISE %' AND s.name NOT LIKE '%WOORI %'
          AND s.name NOT LIKE '%KIWOOM %' AND s.name NOT LIKE '%PLUS %' AND s.name NOT LIKE '%한투 %'
          AND s.name NOT LIKE '%신한 %' AND s.name NOT LIKE '%미래에셋%' AND s.name NOT LIKE '%삼성 %'
          AND s.name NOT LIKE '%KB %' AND s.name NOT LIKE '%TRUE %' AND s.name NOT LIKE '%히어로즈%'
          AND s.name NOT LIKE '%레버리지%' AND s.name NOT LIKE '%인버스%' AND s.name NOT LIKE '%선물%'
          AND s.name NOT LIKE '%ETN%' AND s.name NOT LIKE '%액티브%' AND s.name NOT LIKE '%합성%'
          AND s.name NOT LIKE '%스팩%' AND s.name NOT LIKE '%기업인수목적%'
          AND s.name NOT LIKE '%WON%' AND s.name NOT LIKE '%파워%' AND s.name NOT LIKE '%액티브%'
        )
      ORDER BY change_pct DESC
      LIMIT 10
    `);
    const losersRows = await db.all(`
      WITH latest AS (
        SELECT code, MAX(date) AS d, AVG(close) AS close_now
        FROM daily_prices
        GROUP BY code
      ),
      prev AS (
        SELECT l.code,
               (SELECT close FROM daily_prices WHERE code = l.code AND date < l.d ORDER BY date DESC LIMIT 1) AS close_prev,
               l.d AS latest_d
        FROM latest l
      )
      SELECT s.code, s.name, s.market, s.sector,
             fs.total_score,
             CASE WHEN p.close_prev > 0 THEN ((l.close_now - p.close_prev) / p.close_prev * 100) ELSE NULL END AS change_pct
      FROM latest l
      JOIN prev p ON p.code = l.code
      JOIN stocks s ON s.code = l.code
      LEFT JOIN factor_scores fs ON fs.code = l.code AND fs.date = (SELECT MAX(date) FROM factor_scores)
      WHERE s.market = 'KOSPI' AND p.close_prev > 0
        AND p.close_prev != l.close_now
        AND ((l.close_now - p.close_prev) / p.close_prev * 100) BETWEEN -29.99 AND 29.99
        AND (
          s.name NOT LIKE '%KODEX%' AND s.name NOT LIKE '%TIGER%' AND s.name NOT LIKE '%KBSTAR%'
          AND s.name NOT LIKE '%ARIRANG%' AND s.name NOT LIKE '%KINDEX%' AND s.name NOT LIKE '%SOL %'
          AND s.name NOT LIKE '%ACE %' AND s.name NOT LIKE '%RISE %' AND s.name NOT LIKE '%WOORI %'
          AND s.name NOT LIKE '%KIWOOM %' AND s.name NOT LIKE '%PLUS %' AND s.name NOT LIKE '%한투 %'
          AND s.name NOT LIKE '%신한 %' AND s.name NOT LIKE '%미래에셋%' AND s.name NOT LIKE '%삼성 %'
          AND s.name NOT LIKE '%KB %' AND s.name NOT LIKE '%TRUE %' AND s.name NOT LIKE '%히어로즈%'
          AND s.name NOT LIKE '%레버리지%' AND s.name NOT LIKE '%인버스%' AND s.name NOT LIKE '%선물%'
          AND s.name NOT LIKE '%ETN%' AND s.name NOT LIKE '%액티브%' AND s.name NOT LIKE '%합성%'
          AND s.name NOT LIKE '%스팩%' AND s.name NOT LIKE '%기업인수목적%'
          AND s.name NOT LIKE '%WON%' AND s.name NOT LIKE '%파워%' AND s.name NOT LIKE '%액티브%'
        )
      ORDER BY change_pct ASC
      LIMIT 10
    `);
    writeJson('movers.json', {
      gainers: movers.map((r) => ({
        code: r.code, name: r.name, market: r.market, sector: r.sector,
        total_score: r.total_score ? Number(r.total_score) : 0,
        change_pct: r.change_pct ? Number(r.change_pct) : 0,
      })),
      losers: losersRows.map((r) => ({
        code: r.code, name: r.name, market: r.market, sector: r.sector,
        total_score: r.total_score ? Number(r.total_score) : 0,
        change_pct: r.change_pct ? Number(r.change_pct) : 0,
      })),
    });
  } catch (e) {
    console.error('[export] movers 실패:', e.message);
    writeJson('movers.json', { gainers: [], losers: [] });
  }

  // === 신규: 52주 신고가/신저가 TOP 10 (KOSPI만, ETF/레버리지/인버스/SPAC/우선주 제외) ===
  // 진짜 신고가 = 현재가가 52주 전 최고가(0.99배 이하)보다 높거나 같은 경우만
  // 진짜 신저가 = 현재가가 52주 전 최저가(1.01배 이상)보다 낮거나 같은 경우만
  try {
    const { isExcludedProduct } = require('../src/factors');
    const isExcluded = (n) => isExcludedProduct(n);
    const highLow = await db.all(`
      WITH last52w AS (
        SELECT code, MAX(close) AS week52_high, MIN(close) AS week52_low, COUNT(*) AS days
        FROM daily_prices
        WHERE date >= (SELECT MAX(date) FROM daily_prices) - INTERVAL '52 weeks'
        GROUP BY code
        HAVING COUNT(*) >= 100  -- 최소 100일 데이터 (신규상장 제외)
      ),
      latest AS (
        SELECT code, MAX(close) AS close_now, MAX(date) AS d
        FROM daily_prices
        GROUP BY code
      )
      SELECT CAST(s.code AS VARCHAR) AS code, s.name, s.market, s.sector,
             fs.total_score,
             l52.week52_high, l52.week52_low, lt.close_now
      FROM last52w l52
      JOIN latest lt ON lt.code = l52.code
      JOIN stocks s ON s.code = l52.code
      LEFT JOIN factor_scores fs ON fs.code = l52.code AND fs.date = (SELECT MAX(date) FROM factor_scores)
      WHERE s.market = 'KOSPI' AND l52.week52_high > 0 AND l52.week52_low > 0
    `);
    // 진짜 신고가: close_now가 52주고가의 99% 이상
    const highs = highLow
      .map((r) => ({
        ...r,
        week52_high: Number(r.week52_high),
        week52_low: Number(r.week52_low),
        close_now: Number(r.close_now),
        total_score: r.total_score ? Number(r.total_score) : 0,
      }))
      .filter((r) => r.close_now && r.week52_high && !isExcluded(r.name) && r.close_now >= r.week52_high * 0.99)
      .sort((a, b) => b.close_now / b.week52_high - a.close_now / a.week52_high)
      .slice(0, 10);

    // 진짜 신저가: close_now가 52주저가의 101% 이하
    const lows = highLow
      .map((r) => ({
        ...r,
        week52_high: Number(r.week52_high),
        week52_low: Number(r.week52_low),
        close_now: Number(r.close_now),
        total_score: r.total_score ? Number(r.total_score) : 0,
      }))
      .filter((r) => r.close_now && r.week52_low && !isExcluded(r.name) && r.close_now <= r.week52_low * 1.01)
      .sort((a, b) => a.close_now / a.week52_low - b.close_now / b.week52_low)
      .slice(0, 10);
    writeJson('highlow.json', { highs, lows });
  } catch (e) {
    console.error('[export] highlow 실패:', e.message);
    writeJson('highlow.json', { highs: [], lows: [] });
  }

  // === 신규: 수급 이상 신호 (외인+기관 동시 순매수/매도) ===
  try {
    const { isExcludedProduct } = require('../src/factors');
    const isExcluded = (n) => isExcludedProduct(n);
    const supplyRows = await db.all(`
      WITH ranked AS (
        SELECT code, date, foreign_net, institution_net,
               ROW_NUMBER() OVER (PARTITION BY code ORDER BY date DESC) AS rn
        FROM investor_flow
      )
      SELECT s.code, s.name, s.market, s.sector,
             fs.total_score,
             SUM(foreign_net) FILTER (WHERE rn <= 5) AS foreign_5d,
             SUM(institution_net) FILTER (WHERE rn <= 5) AS inst_5d
      FROM ranked r
      JOIN stocks s ON s.code = r.code
      LEFT JOIN factor_scores fs ON fs.code = r.code AND fs.date = (SELECT MAX(date) FROM factor_scores)
      WHERE s.market IN ('KOSPI','KOSDAQ') AND fs.total_score > 0
      GROUP BY s.code, s.name, s.market, s.sector, fs.total_score
    `);
    const buy = supplyRows
      .filter((r) => r.foreign_5d > 0 && r.inst_5d > 0 && !isExcluded(r.name))
      .sort((a, b) => (Number(b.foreign_5d) + Number(b.inst_5d)) - (Number(a.foreign_5d) + Number(a.inst_5d)))
      .slice(0, 15);
    const sell = supplyRows
      .filter((r) => r.foreign_5d < 0 && r.inst_5d < 0 && !isExcluded(r.name))
      .sort((a, b) => (Number(a.foreign_5d) + Number(a.inst_5d)) - (Number(b.foreign_5d) + Number(b.inst_5d)))
      .slice(0, 15);
    writeJson('supply-signals.json', {
      buy: buy.map((r) => ({
        code: r.code, name: r.name, market: r.market, sector: r.sector,
        total_score: r.total_score ? Number(r.total_score) : 0,
        foreign_5d: Number(r.foreign_5d) || 0,
        inst_5d: Number(r.inst_5d) || 0,
      })),
      sell: sell.map((r) => ({
        code: r.code, name: r.name, market: r.market, sector: r.sector,
        total_score: r.total_score ? Number(r.total_score) : 0,
        foreign_5d: Number(r.foreign_5d) || 0,
        inst_5d: Number(r.inst_5d) || 0,
      })),
    });
  } catch (e) {
    console.error('[export] supply-signals 실패:', e.message);
    writeJson('supply-signals.json', { buy: [], sell: [] });
  }

  // === 신규: 10개 종목 분산 포트폴리오 (섹터 분산, 1/N 비중) ===
  try {
    const { buildPortfolio } = require('../src/data/portfolio');
    // top.json의 KOSPI 메인 (거래정지/우선주/ETF 제외) 중 상위 30개 → 10개 선정
    const topRows = top
      .filter((r) => r.market === 'KOSPI' && r.total_score > 0 && r.status !== 'halt' && r.status !== 'zero_volume')
      .slice(0, 30);
    const portfolio = buildPortfolio(topRows, { maxN: 10, equalWeight: true, maxPerSector: 2 });
    // 시총/외인/기관 5일 추가
    if (portfolio.items.length > 0) {
      const codes = portfolio.items.map((p) => p.code);
      const placeholders = codes.map(() => '?').join(',');
      const closeRows = await db.all(
        `SELECT code, close FROM daily_prices dp
         WHERE (code, date) IN (SELECT code, MAX(date) FROM daily_prices GROUP BY code)
           AND code IN (${placeholders})`,
        codes
      );
      const closeMap = new Map(closeRows.map((c) => [c.code, Number(c.close)]));
      const supRows = await db.all(`
        WITH ranked AS (
          SELECT code, foreign_net, institution_net, ROW_NUMBER() OVER (PARTITION BY code ORDER BY date DESC) AS rn
          FROM investor_flow
          WHERE code IN (${placeholders})
        )
        SELECT code,
               SUM(foreign_net) FILTER (WHERE rn <= 5) AS foreign_5d,
               SUM(institution_net) FILTER (WHERE rn <= 5) AS inst_5d
        FROM ranked GROUP BY code
      `, codes);
      const supMap = new Map(supRows.map((s) => [s.code, s]));
      for (const item of portfolio.items) {
        item.close = closeMap.get(item.code) || 0;
        const sup = supMap.get(item.code) || {};
        item.foreign_5d = Number(sup.foreign_5d) || 0;
        item.inst_5d = Number(sup.inst_5d) || 0;
      }
    }
    portfolio.asOf = new Date().toISOString();
    portfolio.description = '10개 섹터 분산 (1/N=10% 비중), 거래정지/우선주/ETF/액티브/스팩/레버리지/인버스 제외. 1차/2차 매수·매도 신호는 종목 상세 페이지 참고.';
    portfolio.riskManagement = {
      perTradeRisk: '1R = 1% (계좌 대비), 1매매 최대 손실 -7% = 1R',
      totalRisk: '10종목 분산 → 단일 종목 리스크 1/10',
      stopLoss: '1차매도: 매입가 -7% (오닐) OR 5일선 종가 -2% 이탈',
      takeProfit: '2차매도: +21% (3R) OR +8% (단기) OR 60일선 터치',
      rebalance: '월 1회 리밸런싱 권장, 5일선 데드크로스 시 즉시 재평가',
    };
    portfolio.positionSizing = {
      perTradePct: 14, // 1매매 -7% 손실 = 1R = 1% 계좌, → 1매매 14% / 10종목 = 1.4%
      split: { first: 50, second: 30, third: 20 },
      note: '1차매수 50% + 2차매수 30% + 3차매수 20% (분할 진입)',
    };
    writeJson('portfolio.json', portfolio);
    console.log(`[export] portfolio ${portfolio.items.length}개 (섹터 ${Object.keys(portfolio.sectorDistribution).length}개 분산)`);
  } catch (e) {
    console.error('[export] portfolio 실패:', e.message);
    writeJson('portfolio.json', { n: 0, items: [] });
  }

  // 분포 (전체 점수, 10점 단위 bin + 등급 분포 + 평균/중앙값)

  // 분포 (전체 점수, 10점 단위 bin + 등급 분포 + 평균/중앙값 + 시장/섹터/팩터 평균)
  try {
    const distRows = await db.all(`
      SELECT total_score FROM factor_scores
      WHERE date = (SELECT MAX(date) FROM factor_scores) AND total_score > 0
    `);
    let scores = distRows.map((r) => Number(r.total_score) || 0);
    // DB query fallback (DuckDB MAX(date) 바인딩 이슈 대비)
    let validRows = allFactors.filter((r) =>
      r.status !== 'halt' && r.status !== 'zero_volume' && Number(r.total_score) > 0
    );
    if (scores.length === 0) scores = validRows.map((r) => r.total_score);
    // 평균, 중앙값, 최고, 최빈값, 표준편차
    const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const sorted = [...scores].sort((a, b) => a - b);
    const median = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : 0;
    const max = sorted.length ? sorted[sorted.length - 1] : 0;
    const min = sorted.length ? sorted[0] : 0;
    const variance = scores.length ? scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length : 0;
    const std = Math.sqrt(variance);
    // 등급 분포 (A+/A/B+/B/C/D/F)
    const gradeOrder = ['A+', 'A', 'B+', 'B', 'C', 'D', 'F'];
    const gradeCounts = Object.fromEntries(gradeOrder.map((g) => [g, 0]));
    for (const s of scores) {
      const letter = (() => {
        if (s >= 80) return 'A+';
        if (s >= 70) return 'A';
        if (s >= 60) return 'B+';
        if (s >= 50) return 'B';
        if (s >= 40) return 'C';
        if (s >= 30) return 'D';
        return 'F';
      })();
      gradeCounts[letter] = (gradeCounts[letter] || 0) + 1;
    }
    // 10점 단위 bin
    const bins = Array.from({ length: 10 }, (_, i) => ({
      range: `${i * 10}~${i * 10 + 9}`,
      count: 0,
    }));
    for (const s of scores) {
      const idx = Math.min(9, Math.max(0, Math.floor(s / 10)));
      bins[idx].count++;
    }

    // ★ 시장별 분포 (KOSPI vs KOSDAQ)
    const marketStats = { KOSPI: { count: 0, sum: 0, max: 0 }, KOSDAQ: { count: 0, sum: 0, max: 0 } };
    for (const r of validRows) {
      const m = r.market;
      if (!marketStats[m]) marketStats[m] = { count: 0, sum: 0, max: 0 };
      marketStats[m].count++;
      marketStats[m].sum += Number(r.total_score) || 0;
      marketStats[m].max = Math.max(marketStats[m].max, Number(r.total_score) || 0);
    }
    const marketBreakdown = Object.entries(marketStats)
      .filter(([k, v]) => v.count > 0)
      .map(([k, v]) => ({
        market: k,
        count: v.count,
        avg: Number((v.sum / v.count).toFixed(2)),
        max: v.max,
      }))
      .sort((a, b) => b.count - a.count);

    // ★ 섹터별 분포 (상위 12)
    // allFactors rows는 sector 필드가 없으므로 stocks 테이블에서 직접 fetch
    let sectorMap = new Map();
    try {
      if (validRows.length > 0) {
        const codes = validRows.map((r) => r.code);
        const placeholders = codes.map(() => '?').join(',');
        const stockSecRows = await db.all(
          `SELECT code, COALESCE(NULLIF(sector, ''), '미분류') AS sector FROM stocks WHERE code IN (${placeholders})`,
          codes
        );
        const secByCode = new Map(stockSecRows.map((s) => [s.code, s.sector]));
        for (const r of validRows) {
          const sec = secByCode.get(r.code) || '미분류';
          if (!sectorMap.has(sec)) sectorMap.set(sec, { count: 0, sum: 0 });
          sectorMap.get(sec).count++;
          sectorMap.get(sec).sum += Number(r.total_score) || 0;
        }
      }
    } catch (e) {
      console.error('[export] sector 분포 fetch 실패:', e.message);
    }
    const sectorBreakdown = Array.from(sectorMap.entries())
      .map(([sector, v]) => ({
        sector,
        count: v.count,
        avg: Number((v.sum / v.count).toFixed(2)),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    // ★ 팩터별 평균 (전체 종목 vs TOP 20)
    const FACTOR_KEYS = ['value_score', 'momentum_score', 'quality_score', 'volatility_score', 'growth_score', 'liquidity_score', 'supply_score'];
    const factorAvgAll = {};
    const factorAvgTop = {};
    for (const k of FACTOR_KEYS) {
      const all = validRows.map((r) => Number(r[k]) || 0);
      factorAvgAll[k] = all.length ? Number((all.reduce((a, b) => a + b, 0) / all.length).toFixed(2)) : 0;
      const top = validRows.slice(0, 20).map((r) => Number(r[k]) || 0);
      factorAvgTop[k] = top.length ? Number((top.reduce((a, b) => a + b, 0) / top.length).toFixed(2)) : 0;
    }

    writeJson('distribution.json', {
      scores,
      bins,
      gradeCounts,
      marketBreakdown,
      sectorBreakdown,
      factorAvg: { all: factorAvgAll, top20: factorAvgTop },
      summary: {
        count: scores.length,
        mean: Number(mean.toFixed(2)),
        median: Number(median.toFixed(2)),
        min: Number(min.toFixed(2)),
        max: Number(max.toFixed(2)),
        std: Number(std.toFixed(2)),
      },
    });
    console.log(`     → distribution ${scores.length}개 점수, 평균 ${mean.toFixed(1)}점, ${marketBreakdown.length}시장/${sectorBreakdown.length}섹터`);
  } catch (e) {
    console.error('[export] distribution 실패:', e.message);
    writeJson('distribution.json', { scores: [] });
  }

  // 로그
  const logs = await db.all(`SELECT * FROM update_log ORDER BY id DESC LIMIT 10`);
  writeJson('log.json', logs);

  // 백테스트 (daily_prices 기반 historical 13개월 시뮬)
  try {
    console.log('[export] 백테스트 (daily_prices 기반 13개월)...');
    const strategies = require('../src/strategies');
    const bt = await backtestFromDailyPrices({ strategy: strategies.get('balanced'), topN: 20, months: 14 });
    if (!bt.ok) {
      // fallback to factor_scores 기반
      const bt2 = await backtest({ topN: 20, lookbackMonths: 24 });
      writeJson('backtest.json', bt2);
    } else {
      writeJson('backtest.json', bt);
    }
  } catch (e) {
    console.error('[export] backtest 실패:', e.message);
    writeJson('backtest.json', { ok: false, error: e.message });
  }

  // 가중치 최적화 (장기 historical 기반) - 12+ 가중치 × 13개월 시뮬
  try {
    console.log('[export] 가중치 최적화 (12+ 조합 × 13개월)...');
    // DuckDB 락 충돌 회피: calc-strategies는 DB 잠금 필요 → 이미 optimizer.json이 있으면 스킵
    const { execSync } = require('child_process');
    // read-only 모드거나, optimizer.json이 이미 있으면 기존 결과 사용
    const existingOpt = path.join(DATA_DIR, 'optimizer.json');
    if (process.env.DUCKDB_READ_ONLY === '1' || (fs.existsSync(existingOpt) && fs.statSync(existingOpt).size > 1000)) {
      console.log('[export] 기존 optimizer.json 사용 (DuckDB 락 회피)');
    } else {
      try {
        execSync('node scripts/calc-strategies.js', { stdio: 'inherit', cwd: ROOT });
      } catch (e) {
        console.error('[export] calc-strategies 실패:', e.message);
        const opt = await exportOptimizer();
        writeJson('optimizer.json', opt);
      }
    }
  } catch (e) {
    console.error('[export] optimizer 실패:', e.message);
    writeJson('optimizer.json', { ok: false, error: e.message });
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
      signals: (() => {
        try {
          const { calculateSignals } = require('../src/data/signals');
          return calculateSignals(prices, tech.summary);
        } catch (e) { return null; }
      })(),
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

  // initSchema: read_only 모드에서는 스킵 (CREATE 불가)
  if (process.env.DUCKDB_READ_ONLY === '1') {
    console.log('[update] read_only 모드: initSchema 스킵');
  } else {
    await initSchema();
  }

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
