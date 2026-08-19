// 등급별 수익률 검증 (Q의 진짜 완성)
// 신호 추적 데이터 (signal-performance.json / -kosdaq.json) × factor_scores 매트릭스 점수
// DuckDB로 join → 등급별 +5d/+10d/+20d 평균 + 승률
'use strict';
process.chdir('C:/Users/LG/Documents/quant_invest');
process.env.DUCKDB_READ_ONLY = '1';
const fs = require('fs');
const path = require('path');
const db = require('../src/db/connection');

function gradeOf(score, p75, p50, p25) {
  if (score >= p75) return 'A';
  if (score >= p50) return 'B';
  if (score >= p25) return 'C';
  if (score >= p25 - (p50 - p25)) return 'D';
  return 'F';
}

function quantile(arr, q) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  return sorted[base];
}

async function analyzeMarket(market) {
  // 신호 추적 파일 로드
  const sigFile = market === 'KOSPI'
    ? 'public/data/signal-performance.json'
    : 'public/data/signal-performance-kosdaq.json';
  const sig = JSON.parse(fs.readFileSync(path.resolve(sigFile), 'utf8'));
  const allRows = sig.recent || [];
  if (allRows.length === 0) return null;
  console.log(`[${market}] 신호 추적 rows: ${allRows.length}`);

  // DuckDB에서 최신 매트릭스 점수 + 신호 추적의 시점 매트릭스 점수
  // 가장 단순한 접근: 최신 매트릭스 점수 (현재) 사용 (시점 차이는 별도 검증)
  const fsRows = await db.all(`
    SELECT code, total_score, value_score, momentum_score, quality_score,
           growth_score
    FROM factor_scores
    WHERE total_score IS NOT NULL
  `);
  console.log(`[${market}] factor_scores: ${fsRows.length}행`);

  // 매트릭스 점수 → 등급 매핑 (quantile 기반)
  const scoreByCode = new Map();
  const allScores = [];
  for (const r of fsRows) {
    const s = Number(r.total_score) || 0;
    scoreByCode.set(r.code, s);
    allScores.push(s);
  }
  const p90 = quantile(allScores, 0.9);
  const p70 = quantile(allScores, 0.7);
  const p40 = quantile(allScores, 0.4);
  const p20 = quantile(allScores, 0.2);
  console.log(`[${market}] quantile: p90=${p90.toFixed(1)} p70=${p70.toFixed(1)} p40=${p40.toFixed(1)} p20=${p20.toFixed(1)}`);

  // 신호 row에 등급 매핑
  const gradeRows = { A: [], B: [], C: [], D: [], F: [] };
  let matched = 0;
  for (const r of allRows) {
    const s = scoreByCode.get(r.code);
    if (s === undefined) continue;
    matched++;
    let g;
    if (s >= p90) g = 'A';
    else if (s >= p70) g = 'B';
    else if (s >= p40) g = 'C';
    else if (s >= p20) g = 'D';
    else g = 'F';
    gradeRows[g].push(r);
  }
  console.log(`[${market}] 매칭: ${matched}/${allRows.length}`);

  // 등급별 통계
  const out = {};
  for (const g of ['A', 'B', 'C', 'D', 'F']) {
    const rows = gradeRows[g];
    if (rows.length === 0) { out[g] = { signalCount: 0, byType: {} }; continue; }
    const types = ['buy1', 'buy2', 'sell1', 'sell2'];
    const byType = {};
    for (const t of types) {
      const sub = rows.filter((r) => r.type === t);
      if (sub.length === 0) { byType[t] = null; continue; }
      const avg = (k) => sub.reduce((a, b) => a + (b[k] || 0), 0) / sub.length;
      const win = (k, thr) => sub.filter((r) => (r[k] || 0) > thr).length / sub.length;
      byType[t] = {
        total: sub.length,
        avgReturn5d: Number(avg('ret5d').toFixed(2)),
        avgReturn10d: Number(avg('ret10d').toFixed(2)),
        avgReturn20d: Number(avg('ret20d').toFixed(2)),
        winRate5d: Number(win('ret5d', 1).toFixed(3)),
        winRate10d: Number(win('ret10d', 2).toFixed(3)),
        winRate20d: Number(win('ret20d', 3).toFixed(3)),
      };
    }
    out[g] = { signalCount: rows.length, byType };
  }
  return out;
}

(async () => {
  const kospi = await analyzeMarket('KOSPI');
  const kosdaq = await analyzeMarket('KOSDAQ');

  const result = {
    asOf: new Date().toISOString().slice(0, 10),
    note: '현재 매트릭스 점수 기준 등급 분류 (과거 신호 발생 시점 점수가 아닐 수 있음)',
    kospi,
    kosdaq,
    generatedAt: new Date().toISOString(),
  };
  const outPath = path.resolve('public/data/grade-performance.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
  console.log('\n[저장]', outPath);
  console.log(JSON.stringify(result, null, 2));
  await db.close();
})().catch((e) => { console.error('ERR:', e); process.exit(1); });
