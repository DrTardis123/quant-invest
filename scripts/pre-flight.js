// Pre-flight 검증: 일일 신호 생성 전 sanity check
// — DB 신선도, 유니버스 크기, 회로차단기, holdings 유효성
// — 실패 시 신호 생성 중지, ops-status.json에 기록
'use strict';
process.chdir('C:/Users/LG/Documents/quant_invest');
delete process.env.DUCKDB_READ_ONLY;

const fs = require('fs');
const path = require('path');
const db = require('../src/db/connection');
const risk = require('../src/data/risk');

const DATA_DIR = path.join(__dirname, '..', 'public', 'data');
const OPS_FILE = path.join(DATA_DIR, 'ops-status.json');
const PORTFOLIO_FILE = path.join(DATA_DIR, 'portfolio-state.json');
const HOLDINGS_FILE = path.join(DATA_DIR, 'holdings.json');

async function main() {
  const t0 = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  console.log(`=== Pre-flight 검증 (${today}) ===\n`);

  // 1) DB pre-flight
  console.log('[1/4] DB / 데이터 신선도 검증...');
  const pf = await risk.preFlight(db);
  console.log(`  마지막 데이터: ${pf.stats.lastDataDate} (${pf.stats.dataAgeDays}일 전)`);
  console.log(`  유니버스: ${pf.stats.universeSize}개, 활성: ${pf.stats.activeStocks}개`);
  console.log(`  회로차단기: ${pf.stats.circuitBreaker || 'N/A'}`);
  if (pf.errors.length > 0) {
    console.log(`  [ERROR]`);
    pf.errors.forEach((e) => console.log(`    - ${e}`));
  }
  if (pf.warnings.length > 0) {
    console.log(`  [WARN]`);
    pf.warnings.forEach((w) => console.log(`    - ${w}`));
  }

  // 2) 회로차단기 평가
  console.log('\n[2/4] 회로차단기 평가...');
  let portfolio = {};
  if (fs.existsSync(PORTFOLIO_FILE)) {
    portfolio = JSON.parse(fs.readFileSync(PORTFOLIO_FILE, 'utf-8'));
  }
  const cb = risk.circuitBreaker({
    totalEquity: portfolio.totalEquity || 0,
    peakEquity: portfolio.peakEquity || 0,
    dailyReturn: portfolio.dailyReturn || 0,
    weeklyReturn: portfolio.weeklyReturn || 0,
    mdd: portfolio.mdd || 0,
    consecutiveLosses: portfolio.consecutiveLosses || 0,
  });
  console.log(`  상태: ${cb.status}`);
  console.log(`  MDD: ${(cb.thresholds.mddLimit * 100).toFixed(0)}% / 일일: ${(cb.thresholds.dailyLimit * 100).toFixed(0)}% / 주간: ${(cb.thresholds.weeklyLimit * 100).toFixed(0)}% / 연속손실: ${cb.thresholds.consecutiveLossLimit}일`);
  console.log(`  현재 MDD: ${(portfolio.mdd * 100 || 0).toFixed(2)}%`);
  console.log(`  현재 일일: ${(portfolio.dailyReturn * 100 || 0).toFixed(2)}%`);
  if (cb.halt) {
    console.log(`  [HALT] ${cb.reason}`);
  } else if (cb.warnings.length > 0) {
    cb.warnings.forEach((w) => console.log(`  [WARN] ${w}`));
  }

  // 3) holdings.json 검증
  console.log('\n[3/4] holdings.json 검증...');
  let holdings = [];
  if (fs.existsSync(HOLDINGS_FILE)) {
    try {
      holdings = JSON.parse(fs.readFileSync(HOLDINGS_FILE, 'utf-8'));
      if (!Array.isArray(holdings)) holdings = [];
    } catch (e) {
      console.log(`  [ERROR] holdings.json 파싱 실패: ${e.message}`);
    }
  } else {
    console.log(`  holdings.json 없음 (모의투자 미실행)`);
  }
  if (holdings.length > 0) {
    console.log(`  보유 종목: ${holdings.length}개`);
    for (const h of holdings) {
      if (!h.code || !h.shares || !h.avgPrice) {
        console.log(`    [WARN] ${h.code || '?'}: 필드 누락 (code/shares/avgPrice)`);
      } else {
        const value = h.shares * (h.currentPrice || h.avgPrice);
        console.log(`    ${h.code} (${h.name || '?'}): ${h.shares}주 @ ${h.avgPrice} → ${value.toLocaleString()}원${h.stopLoss ? `, 손절 ${(h.stopLoss * 100).toFixed(0)}%` : ''}${h.takeProfit ? `, 익절 ${(h.takeProfit * 100).toFixed(0)}%` : ''}`);
      }
    }
  }

  // 4) ops-status.json 갱신
  console.log('\n[4/4] ops-status.json 갱신...');
  const status = risk.updateOpsStatus(OPS_FILE, {
    date: today,
    preflight: {
      ok: pf.ok,
      errors: pf.errors,
      warnings: pf.warnings,
      stats: pf.stats,
    },
    circuitBreaker: cb,
    portfolio: {
      lastDate: portfolio.lastDate,
      totalEquity: portfolio.totalEquity,
      peakEquity: portfolio.peakEquity,
      dailyReturn: portfolio.dailyReturn,
      weeklyReturn: portfolio.weeklyReturn,
      mdd: portfolio.mdd,
      consecutiveLosses: portfolio.consecutiveLosses,
    },
    holdings: {
      count: holdings.length,
      items: holdings,
    },
    thresholds: cb.thresholds,
  });
  console.log(`  → ${OPS_FILE} 저장`);

  // 5) 최종 결정
  console.log('\n=== Pre-flight 결과 ===');
  const blocked = !pf.ok || cb.halt;
  if (blocked) {
    console.log('  ⛔ 신호 생성 차단');
    if (!pf.ok) console.log('    - 데이터 신선도 / 유니버스 오류');
    if (cb.halt) console.log(`    - 회로차단기: ${cb.reason}`);
    process.exit(1);
  } else {
    console.log('  ✅ 신호 생성 가능');
  }

  console.log(`\n총 소요: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await db.close();
}

main().catch((e) => { console.error('fatal:', e); process.exit(1); });
