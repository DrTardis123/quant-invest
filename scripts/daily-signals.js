// 일일 신호 자동 생성 (장 마감 후 실행)
// — 당일 일봉 + 매트릭스 계산
// — public/data/signals.json 갱신
// — 1차매수/2차매수/1차매도/2차매도 신호 추출
// — KOSPI/KOSDAQ Top 신호 종목 표시
'use strict';
process.chdir('C:/Users/LG/Documents/quant_invest');
delete process.env.DUCKDB_READ_ONLY;

const fs = require('fs');
const path = require('path');
const db = require('../src/db/connection');
const signals = require('../src/data/signals');
const { calculateMarketRegime } = require('../src/data/market');
const { isExcludedProduct } = require('../src/data/filters');

const DATA_DIR = path.join(__dirname, '..', 'public', 'data');
const SIGNALS_FILE = path.join(DATA_DIR, 'signals.json');

function n(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return Number(v);
  if (v && typeof v === 'object' && 'days' in v) {
    return new Date(Date.UTC(1970, 0, 1) + v.days * 86400000).toISOString().slice(0, 10);
  }
  return v;
}

async function main() {
  const t0 = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  console.log(`=== 일일 신호 생성 (${today}) ===\n`);

  // 1) DB에서 모든 활성 종목 + 최근 일봉 로드
  console.log('[1/4] 활성 종목 + 일봉 로드...');
  const sql = `
    SELECT s.code, s.name, s.market, s.sector,
      dp.date, dp.open, dp.high, dp.low, dp.close, dp.volume, dp.trading_value, dp.market_cap
    FROM daily_prices dp
    JOIN stocks s ON s.code = dp.code
    WHERE dp.date = (SELECT MAX(date) FROM daily_prices)
      AND s.market IN ('KOSPI', 'KOSDAQ')
    ORDER BY dp.trading_value DESC NULLS LAST
  `;
  const rows = await db.all(sql);
  console.log(`  ${rows.length}개 종목 (당일 거래)`);

  // 2) ETF/우선주/스팩 제외
  console.log('\n[2/4] 매트릭스 계산 (제외 종목 필터)...');
  const eligible = rows.filter((r) => !isExcludedProduct(r.name, r.code));
  console.log(`  유니버스: ${eligible.length}개 (제외 ${rows.length - eligible.length}개)`);

  // 3) 매트릭스 계산
  console.log('\n[3/4] 14개 요소 매트릭스...');
  const results = [];
  for (const r of eligible.slice(0, 300)) {  // Top 300 (메모리/시간 절약)
    try {
      const matrix = await signals.calculateMatrix(r.code);
      if (!matrix) continue;
      // 1차매수/2차매수/1차매도/2차매도 평가
      const sig = signals.evaluateSignals(matrix);
      const score = matrix.total || 0;
      results.push({
        code: r.code,
        name: r.name,
        market: r.market,
        sector: r.sector,
        close: Number(r.close),
        trading_value: Number(r.trading_value || 0),
        market_cap: Number(r.market_cap || 0),
        score,
        grade: matrix.grade || 'F',
        matrix,
        signals: sig,
      });
    } catch (e) {
      // skip
    }
  }
  // 점수 내림차순
  results.sort((a, b) => b.score - a.score);
  console.log(`  ${results.length}개 매트릭스 계산 완료 (${((Date.now()-t0)/1000).toFixed(1)}s)`);

  // 4) 신호 분류
  console.log('\n[4/4] 신호 추출 + JSON 저장...');
  const buy1 = [];
  const buy2 = [];
  const sell1 = [];
  const sell2 = [];
  for (const r of results) {
    const s = r.signals;
    if (s.buy1?.active) {
      buy1.push({
        code: r.code, name: r.name, market: r.market,
        score: r.score, grade: r.grade,
        price: s.buy1.price, reason: s.buy1.reasons,
      });
    }
    if (s.buy2?.active) {
      buy2.push({
        code: r.code, name: r.name, market: r.market,
        score: r.score, grade: r.grade,
        price: s.buy2.price, reason: s.buy2.reasons,
      });
    }
    if (s.sell1?.active) {
      sell1.push({
        code: r.code, name: r.name, market: r.market,
        score: r.score, grade: r.grade,
        price: s.sell1.price, reason: s.sell1.reasons,
      });
    }
    if (s.sell2?.active) {
      sell2.push({
        code: r.code, name: r.name, market: r.market,
        score: r.score, grade: r.grade,
        price: s.sell2.price, reason: s.sell2.reasons,
      });
    }
  }
  // 매트릭스 점수 상위 10개
  const top10 = results.slice(0, 10).map((r) => ({
    code: r.code, name: r.name, market: r.market,
    score: r.score, grade: r.grade, close: r.close,
  }));

  // 시장 평가
  let marketRegime = null;
  try {
    marketRegime = await calculateMarketRegime(db);
  } catch (e) {
    console.log('  시장 평가 계산 실패:', e.message);
  }

  // JSON 저장
  const out = {
    date: today,
    updatedAt: new Date().toISOString(),
    universeSize: eligible.length,
    matrixCalculated: results.length,
    top10,
    buy1: buy1.slice(0, 30),
    buy2: buy2.slice(0, 20),
    sell1: sell1.slice(0, 30),
    sell2: sell2.slice(0, 20),
    marketRegime,
    stats: {
      buy1Count: buy1.length,
      buy2Count: buy2.length,
      sell1Count: sell1.length,
      sell2Count: sell2.length,
    },
  };
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SIGNALS_FILE, JSON.stringify(out, null, 2));
  console.log(`  ${SIGNALS_FILE} 저장 완료`);
  console.log(`  → 1차매수: ${buy1.length}개, 2차매수: ${buy2.length}개`);
  console.log(`  → 1차매도: ${sell1.length}개, 2차매도: ${sell2.length}개`);

  // 알림 (Slack/Telegram webhook - 환경변수로 활성화)
  if (process.env.ALERT_WEBHOOK) {
    const message = `📊 [${today}] 퀀트투자 신호\n` +
      `1차매수: ${buy1.length}개 | 2차매수: ${buy2.length}개\n` +
      `1차매도: ${sell1.length}개 | 2차매도: ${sell2.length}개\n` +
      `시장: ${marketRegime?.label || '—'} (${marketRegime?.score?.toFixed(1) || '—'})`;
    try {
      const https = require('https');
      const url = new URL(process.env.ALERT_WEBHOOK);
      const data = JSON.stringify({ text: message });
      const req = https.request({
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      req.write(data);
      req.end();
      console.log(`  알림 전송: ${process.env.ALERT_WEBHOOK}`);
    } catch (e) {
      console.log('  알림 실패:', e.message);
    }
  }

  console.log(`\n총 소요: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('=== 완료 ===');
  await db.close();
}

main().catch((e) => { console.error('fatal:', e); process.exit(1); });
