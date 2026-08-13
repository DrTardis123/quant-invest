'use strict';

// 백테스트 별도 export (EXPORT_ONLY에서 실패 시)
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);
const fs = require('fs');
const { backtestFromDailyPrices } = require('../src/scoring/backtest');
const strategies = require('../src/strategies');

(async () => {
  console.log('[backtest] 13개월 historical 시뮬레이션...');
  const t0 = Date.now();
  try {
    const bt = await backtestFromDailyPrices({ strategy: strategies.get('balanced'), topN: 20, months: 14 });
    if (bt.ok) {
      fs.writeFileSync(path.join(ROOT, 'public', 'data', 'backtest.json'), JSON.stringify(bt, (_k, v) => typeof v === 'bigint' ? Number(v) : v, 2));
      console.log(`  → Total ${(bt.totalReturn * 100).toFixed(1)}% | CAGR ${(bt.cagr * 100).toFixed(1)}% | Sharpe ${bt.sharpe} | MDD ${(bt.mdd * 100).toFixed(1)}% | Win ${(bt.winRate * 100).toFixed(0)}%`);
    } else {
      fs.writeFileSync(path.join(ROOT, 'public', 'data', 'backtest.json'), JSON.stringify({ ok: false, error: bt.error }));
    }
  } catch (e) {
    console.error('[backtest] 실패:', e.message);
    fs.writeFileSync(path.join(ROOT, 'public', 'data', 'backtest.json'), JSON.stringify({ ok: false, error: e.message }));
  }
  console.log(`[backtest] 완료 ${(Date.now() - t0) / 1000}s`);
  process.exit(0);
})();
