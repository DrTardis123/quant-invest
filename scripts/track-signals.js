// 신호 일지 자동 누적 (signal-performance.json)
// — 매일 1차매수 신호가 발생하면 +10d 후 수익률 추적
// — win rate / avg return / 카테고리별 hit rate
'use strict';
process.chdir('C:/Users/LG/Documents/quant_invest');
delete process.env.DUCKDB_READ_ONLY;

const fs = require('fs');
const path = require('path');
const db = require('../src/db/connection');

const DATA_DIR = path.join(__dirname, '..', 'public', 'data');
const SIGNALS_FILE = path.join(DATA_DIR, 'signals.json');
const PERF_FILE = path.join(DATA_DIR, 'signal-performance.json');

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
  console.log(`=== 신호 일지 추적 (${today}) ===\n`);

  // 1) 데이터 로드
  if (!fs.existsSync(SIGNALS_FILE)) {
    console.log(`  signals.json 없음`);
    return;
  }
  const signals = JSON.parse(fs.readFileSync(SIGNALS_FILE, 'utf8'));
  let perf = { tracked: [], summary: {} };
  if (fs.existsSync(PERF_FILE)) {
    perf = JSON.parse(fs.readFileSync(PERF_FILE, 'utf8'));
  }
  console.log(`[1/4] 누적 추적 신호: ${perf.tracked.length}개`);

  // 2) 기존 추적 신호의 +10d 후 가격 조회
  console.log('\n[2/4] +10d 후 수익률 계산...');
  const completed = [];
  const stillTracking = [];
  for (const t of perf.tracked) {
    const daysElapsed = Math.floor((new Date(today) - new Date(t.signalDate)) / 86400000);
    if (daysElapsed >= 10) {
      // +10d 후 가격 가져오기
      const sql = `SELECT date, close FROM daily_prices WHERE code = ? AND date BETWEEN ? AND date_add(?, INTERVAL 14 DAY) ORDER BY date ASC LIMIT 1`;
      const buyDate = t.signalDate;
      const plus10 = new Date(new Date(buyDate).getTime() + 14 * 86400000).toISOString().slice(0, 10);
      const row = await db.one(sql, [t.code, buyDate, buyDate]).catch(() => null);
      const targetRow = await db.one(sql, [t.code, buyDate, plus10]).catch(() => null);
      if (targetRow) {
        const exitPrice = Number(targetRow.close);
        const entryPrice = t.price;
        const returnPct = ((exitPrice - entryPrice) / entryPrice) * 100;
        completed.push({
          ...t,
          exitDate: String(targetRow.date).slice(0, 10),
          exitPrice,
          return10d: Number(returnPct.toFixed(2)),
          win: returnPct > 0,
        });
      } else {
        completed.push({ ...t, exitDate: null, exitPrice: null, return10d: null });
      }
    } else {
      stillTracking.push(t);
    }
  }
  console.log(`  완료: ${completed.length}개, 추적 중: ${stillTracking.length}개`);

  // 3) 오늘의 1차매수 신호 추가
  console.log('\n[3/4] 오늘 1차매수 신호 추가...');
  const existing = new Set(perf.tracked.map((t) => `${t.code}_${t.signalDate}`));
  let added = 0;
  for (const b of signals.buy1 || []) {
    const key = `${b.code}_${today}`;
    if (!existing.has(key)) {
      stillTracking.push({
        code: b.code,
        name: b.name,
        market: b.market,
        signalDate: today,
        price: b.price,
        score: b.score,
        grade: b.grade,
        reason: b.reason,
      });
      added++;
    }
  }
  console.log(`  추가: ${added}개`);

  // 4) 통계 계산
  console.log('\n[4/4] 통계 계산...');
  const valid = completed.filter((c) => c.return10d !== null);
  const total = valid.length;
  const wins = valid.filter((c) => c.return10d > 0).length;
  const losses = valid.filter((c) => c.return10d <= 0).length;
  const winRate = total > 0 ? (wins / total * 100) : 0;
  const avgReturn = total > 0 ? valid.reduce((a, b) => a + b.return10d, 0) / total : 0;
  const avgWin = wins > 0 ? valid.filter((c) => c.return10d > 0).reduce((a, b) => a + b.return10d, 0) / wins : 0;
  const avgLoss = losses > 0 ? valid.filter((c) => c.return10d <= 0).reduce((a, b) => a + b.return10d, 0) / losses : 0;
  // 카테고리별 (등급별)
  const byGrade = {};
  for (const c of valid) {
    if (!byGrade[c.grade]) byGrade[c.grade] = { total: 0, wins: 0, returnSum: 0 };
    byGrade[c.grade].total++;
    if (c.return10d > 0) byGrade[c.grade].wins++;
    byGrade[c.grade].returnSum += c.return10d;
  }
  for (const g of Object.keys(byGrade)) {
    byGrade[g].winRate = byGrade[g].total > 0 ? (byGrade[g].wins / byGrade[g].total * 100) : 0;
    byGrade[g].avgReturn = byGrade[g].total > 0 ? byGrade[g].returnSum / byGrade[g].total : 0;
  }
  // 시장별
  const byMarket = {};
  for (const c of valid) {
    if (!byMarket[c.market]) byMarket[c.market] = { total: 0, wins: 0, returnSum: 0 };
    byMarket[c.market].total++;
    if (c.return10d > 0) byMarket[c.market].wins++;
    byMarket[c.market].returnSum += c.return10d;
  }
  for (const m of Object.keys(byMarket)) {
    byMarket[m].winRate = byMarket[m].total > 0 ? (byMarket[m].wins / byMarket[m].total * 100) : 0;
    byMarket[m].avgReturn = byMarket[m].total > 0 ? byMarket[m].returnSum / byMarket[m].total : 0;
  }

  // JSON 저장
  const out = {
    updatedAt: new Date().toISOString(),
    tracked: stillTracking,
    completed,
    summary: {
      total, wins, losses, winRate: Number(winRate.toFixed(1)),
      avgReturn: Number(avgReturn.toFixed(2)),
      avgWin: Number(avgWin.toFixed(2)),
      avgLoss: Number(avgLoss.toFixed(2)),
      byGrade, byMarket,
    },
  };
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PERF_FILE, JSON.stringify(out, null, 2));
  console.log(`  ${PERF_FILE} 저장`);
  console.log(`\n=== 신호 추적 통계 ===`);
  console.log(`  누적: ${total}개 | 승률: ${winRate.toFixed(1)}% | 평균: ${avgReturn.toFixed(2)}%`);
  console.log(`  평균 익절: +${avgWin.toFixed(2)}% | 평균 손절: ${avgLoss.toFixed(2)}%`);

  console.log(`\n총 소요: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('=== 완료 ===');
  await db.close();
}

main().catch((e) => { console.error('fatal:', e); process.exit(1); });
