// 손절/익절 알림 (보유 종목 추적)
// — 사용자가 입력한 보유 종목 (holdings.json)을 일봉과 비교
// — 손실률 / 매트릭스 점수 변화 추적
// — 손절/익절 신호 발생시 알림
'use strict';
process.chdir('C:/Users/LG/Documents/quant_invest');
delete process.env.DUCKDB_READ_ONLY;

const fs = require('fs');
const path = require('path');
const db = require('../src/db/connection');
const signals = require('../src/data/signals');
const { calculateMarketRegime } = require('../src/data/market');

const DATA_DIR = path.join(__dirname, '..', 'public', 'data');
const HOLDINGS_FILE = path.join(DATA_DIR, 'holdings.json');
const ALERTS_FILE = path.join(DATA_DIR, 'alerts.json');

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
  console.log(`=== 손절/익절 알림 (${today}) ===\n`);

  // 1) 보유 종목 로드
  if (!fs.existsSync(HOLDINGS_FILE)) {
    console.log(`  보유 종목 파일 없음: ${HOLDINGS_FILE}`);
    console.log(`  → 빈 holdings.json 생성 후 종목 입력 필요`);
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(HOLDINGS_FILE, JSON.stringify({
      updatedAt: today,
      holdings: [],
    }, null, 2));
    console.log(`  빈 holdings.json 생성 완료`);
    await db.close();
    return;
  }
  const holdingsData = JSON.parse(fs.readFileSync(HOLDINGS_FILE, 'utf8'));
  const holdings = holdingsData.holdings || [];
  if (holdings.length === 0) {
    console.log('  보유 종목 없음');
    await db.close();
    return;
  }
  console.log(`[1/4] 보유 종목 ${holdings.length}개 추적...`);

  // 2) 당일 일봉 + 매트릭스 계산
  console.log('\n[2/4] 당일 일봉 + 매트릭스...');
  const codes = holdings.map((h) => h.code);
  const sql = `
    SELECT s.code, s.name, s.market,
      dp.date, dp.close, dp.open, dp.high, dp.low, dp.volume, dp.trading_value
    FROM daily_prices dp
    JOIN stocks s ON s.code = dp.code
    WHERE dp.date = (SELECT MAX(date) FROM daily_prices)
      AND s.code IN (${codes.map((c) => `'${c}'`).join(',')})
  `;
  const rows = await db.all(sql);
  const codeMap = new Map(rows.map((r) => [r.code, r]));

  // 3) 알림 추출
  console.log('\n[3/4] 손절/익절 알림 추출...');
  const alerts = [];
  for (const h of holdings) {
    const r = codeMap.get(h.code);
    if (!r) continue;
    const currentPrice = Number(r.close);
    const buyPrice = h.buyPrice;
    const pnlPct = buyPrice > 0 ? ((currentPrice - buyPrice) / buyPrice) * 100 : 0;
    const pnlAmount = (currentPrice - buyPrice) * h.quantity;

    // 매트릭스 계산
    let matrix = null;
    try {
      matrix = await signals.calculateMatrix(h.code);
    } catch (e) { /* skip */ }
    const score = matrix?.total || 0;
    const grade = matrix?.grade || 'F';

    // 알림 조건
    const reasons = [];
    let severity = 'info';
    let action = 'hold';

    // 손절 (1차매도)
    if (pnlPct <= -7) {
      reasons.push(`매입가 -7% 손절 도달 (${pnlPct.toFixed(2)}%)`);
      severity = 'critical';
      action = 'sell1';
    } else if (pnlPct <= -5) {
      reasons.push(`매입가 -5% 주의 (${pnlPct.toFixed(2)}%)`);
      severity = 'warning';
      action = 'review';
    }
    // 매트릭스 D/F (강한 매도 신호)
    if (grade === 'D' || grade === 'F') {
      reasons.push(`매트릭스 ${grade} 등급 (점수 ${score.toFixed(0)})`);
      severity = severity === 'critical' ? 'critical' : 'warning';
      action = action === 'sell1' ? 'sell1' : 'review';
    }
    // 익절 (2차매도)
    if (pnlPct >= 21) {
      reasons.push(`매입가 +21% 익절 도달 (${pnlPct.toFixed(2)}%)`);
      severity = severity === 'critical' ? 'critical' : 'success';
      action = 'sell2';
    } else if (pnlPct >= 10) {
      reasons.push(`매입가 +10% 익절 준비 (${pnlPct.toFixed(2)}%)`);
      if (severity === 'info') severity = 'success';
      if (action === 'hold') action = 'review';
    }
    // 거래량/거래대금 경고
    if (Number(r.trading_value || 0) < 1e8) {
      reasons.push(`유동성 부족 (거래대금 1억 미만)`);
      severity = severity === 'critical' ? 'critical' : 'warning';
    }

    if (reasons.length > 0) {
      alerts.push({
        code: h.code,
        name: r.name,
        market: r.market,
        buyPrice,
        currentPrice,
        pnlPct: Number(pnlPct.toFixed(2)),
        pnlAmount: Math.round(pnlAmount),
        quantity: h.quantity,
        score: Number(score.toFixed(0)),
        grade,
        severity,
        action,
        reasons,
        asOf: today,
      });
    }
  }
  // 심각도 순 정렬
  const sevOrder = { critical: 0, warning: 1, success: 2, info: 3 };
  alerts.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);

  console.log(`  ${alerts.length}개 알림 추출`);
  for (const a of alerts) {
    const icon = a.severity === 'critical' ? '🚨' : a.severity === 'warning' ? '⚠️' : a.severity === 'success' ? '✨' : 'ℹ️';
    console.log(`    ${icon} ${a.name} (${a.code}): ${a.pnlPct}% | 점수 ${a.score}(${a.grade}) | ${a.action}`);
  }

  // 4) JSON 저장 + 알림
  console.log('\n[4/4] JSON 저장 + 알림...');
  const marketRegime = await calculateMarketRegime(db).catch(() => null);
  const out = {
    date: today,
    updatedAt: new Date().toISOString(),
    totalHoldings: holdings.length,
    alertCount: alerts.length,
    criticalCount: alerts.filter((a) => a.severity === 'critical').length,
    warningCount: alerts.filter((a) => a.severity === 'warning').length,
    successCount: alerts.filter((a) => a.severity === 'success').length,
    alerts,
    marketRegime,
  };
  fs.writeFileSync(ALERTS_FILE, JSON.stringify(out, null, 2));
  console.log(`  ${ALERTS_FILE} 저장`);

  // 알림
  if (process.env.ALERT_WEBHOOK && alerts.length > 0) {
    const lines = alerts.slice(0, 10).map((a) => {
      const icon = a.severity === 'critical' ? '🚨' : a.severity === 'warning' ? '⚠️' : '✨';
      return `${icon} ${a.name}: ${a.pnlPct}% | ${a.action}`;
    });
    const message = `📊 [${today}] 손절/익절 알림\n${alerts.length}개\n${lines.join('\n')}`;
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
      console.log(`  알림 전송 완료`);
    } catch (e) {
      console.log('  알림 실패:', e.message);
    }
  }

  console.log(`\n총 소요: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('=== 완료 ===');
  await db.close();
}

main().catch((e) => { console.error('fatal:', e); process.exit(1); });
