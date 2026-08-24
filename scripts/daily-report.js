// 일일 리포트 자동 생성
// — 어제 신호 / 오늘 신호 / 신호 변화
// — 매트릭스 점수 상위 종목
// — 시장 평가
// — 보유 종목 손익 (있으면)
'use strict';
process.chdir('C:/Users/LG/Documents/quant_invest');
delete process.env.DUCKDB_READ_ONLY;

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'public', 'data');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const SIGNALS_FILE = path.join(DATA_DIR, 'signals.json');
const ALERTS_FILE = path.join(DATA_DIR, 'alerts.json');
const SIGNAL_PERF_FILE = path.join(DATA_DIR, 'signal-performance.json');

function main() {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`=== 일일 리포트 생성 (${today}) ===\n`);

  // 1) 데이터 로드
  if (!fs.existsSync(SIGNALS_FILE)) {
    console.log(`  신호 파일 없음: ${SIGNALS_FILE}`);
    console.log('  daily-signals.js 먼저 실행 필요');
    return;
  }
  const signals = JSON.parse(fs.readFileSync(SIGNALS_FILE, 'utf8'));
  const alerts = fs.existsSync(ALERTS_FILE)
    ? JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8')) : null;
  const signalPerf = fs.existsSync(SIGNAL_PERF_FILE)
    ? JSON.parse(fs.readFileSync(SIGNAL_PERF_FILE, 'utf8')) : null;

  // 2) 마크다운 리포트 생성
  const lines = [];
  lines.push(`# 일일 리포트 — ${today}`);
  lines.push('');
  lines.push(`> 자동 생성: ${new Date().toISOString()}`);
  lines.push('');

  // 시장 평가
  lines.push('## 📊 시장 평가');
  if (signals.marketRegime) {
    const m = signals.marketRegime;
    lines.push(`- **점수**: ${m.score?.toFixed(1) || '—'} / 95`);
    lines.push(`- **분류**: ${m.label || '—'} ${m.emoji || ''}`);
    lines.push(`- **신호**: ${m.signal || '—'}`);
    lines.push(`- **배경색**: ${m.bgColor || 'gray'}`);
  } else {
    lines.push('- 데이터 없음');
  }
  lines.push('');

  // 신호 통계
  lines.push('## 📡 신호 통계');
  lines.push(`- **유니버스**: ${signals.universeSize || 0}개`);
  lines.push(`- **매트릭스 계산**: ${signals.matrixCalculated || 0}개`);
  lines.push(`- **1차매수 🟢**: ${signals.stats?.buy1Count || 0}개`);
  lines.push(`- **2차매수 🟡**: ${signals.stats?.buy2Count || 0}개`);
  lines.push(`- **1차매도 🔵**: ${signals.stats?.sell1Count || 0}개`);
  lines.push(`- **2차매도 🟢**: ${signals.stats?.sell2Count || 0}개`);
  lines.push('');

  // Top 10 매트릭스
  lines.push('## ⭐ 매트릭스 Top 10');
  lines.push('| # | 종목 | 시장 | 점수 | 등급 | 종가 |');
  lines.push('|---|---|---|---:|---:|---:|');
  for (let i = 0; i < (signals.top10 || []).length; i++) {
    const r = signals.top10[i];
    lines.push(`| ${i + 1} | **${r.name}** (${r.code}) | ${r.market} | ${r.score?.toFixed(1)} | ${r.grade} | ${r.close?.toLocaleString()} |`);
  }
  lines.push('');

  // 1차매수 종목
  if (signals.buy1 && signals.buy1.length > 0) {
    lines.push('## 🟢 1차매수 신호');
    lines.push('| 종목 | 시장 | 점수 | 등급 | 가격 | 이유 |');
    lines.push('|---|---|---:|---:|---:|---|');
    for (const r of signals.buy1.slice(0, 15)) {
      const reason = (r.reason || []).slice(0, 2).join(' · ');
      lines.push(`| **${r.name}** (${r.code}) | ${r.market} | ${r.score?.toFixed(1)} | ${r.grade} | ${r.price?.toLocaleString()} | ${reason} |`);
    }
    lines.push('');
  }

  // 1차매도 (손절) 종목
  if (signals.sell1 && signals.sell1.length > 0) {
    lines.push('## 🔵 1차매도 신호 (손절)');
    lines.push('| 종목 | 시장 | 점수 | 등급 | 가격 | 이유 |');
    lines.push('|---|---|---:|---:|---:|---|');
    for (const r of signals.sell1.slice(0, 10)) {
      const reason = (r.reason || []).slice(0, 2).join(' · ');
      lines.push(`| **${r.name}** (${r.code}) | ${r.market} | ${r.score?.toFixed(1)} | ${r.grade} | ${r.price?.toLocaleString()} | ${reason} |`);
    }
    lines.push('');
  }

  // 보유 종목 알림
  if (alerts && alerts.alerts && alerts.alerts.length > 0) {
    lines.push(`## 🚨 보유 종목 알림 (${alerts.alertCount}개)`);
    lines.push(`- **🚨 Critical**: ${alerts.criticalCount}개 (즉시 확인)`);
    lines.push(`- **⚠️ Warning**: ${alerts.warningCount}개`);
    lines.push(`- **✨ Success**: ${alerts.successCount}개 (익절)`);
    lines.push('');
    lines.push('| 종목 | 매입가 | 현재가 | 손익률 | 손익액 | 점수 | 등급 | 액션 |');
    lines.push('|---|---:|---:|---:|---:|---:|---:|---|');
    for (const a of alerts.alerts.slice(0, 15)) {
      lines.push(`| **${a.name}** (${a.code}) | ${a.buyPrice?.toLocaleString()} | ${a.currentPrice?.toLocaleString()} | ${a.pnlPct}% | ${a.pnlAmount?.toLocaleString()} | ${a.score} | ${a.grade} | ${a.action} |`);
    }
    lines.push('');
  } else {
    lines.push('## 💼 보유 종목 알림');
    lines.push('- 보유 종목 없음 (holdings.json 등록 필요)');
    lines.push('');
  }

  // 신호 추적 (1차매수 후 +10d)
  if (signalPerf && signalPerf.tracked) {
    const tracked = signalPerf.tracked;
    const total = tracked.length;
    const wins = tracked.filter((t) => t.return10d > 0).length;
    const winRate = total > 0 ? (wins / total * 100) : 0;
    const avgReturn = total > 0
      ? tracked.reduce((a, b) => a + b.return10d, 0) / total
      : 0;
    lines.push('## 📈 신호 추적 (1차매수 후 +10d)');
    lines.push(`- **누적 신호**: ${total}개`);
    lines.push(`- **승률**: ${winRate.toFixed(1)}% (${wins}/${total})`);
    lines.push(`- **평균 수익률**: ${avgReturn.toFixed(2)}%`);
    lines.push('');
  }

  // 권장 행동
  lines.push('## 🎯 권장 행동');
  lines.push('');
  lines.push('### 1. 매수 검토');
  lines.push('- 1차매수 🟢 종목 중 매트릭스 A/B 등급 (점수 60+)');
  lines.push('- 손익비 1:3 이상 (손절 -7% / 익절 +21%)');
  lines.push('- 시장 평가가 공포(<30) 아니어야 안전');
  lines.push('');
  lines.push('### 2. 매도 검토');
  lines.push('- 1차매도 🔵 = 손절 (즉시 매도)');
  lines.push('- 2차매도 🟢 = 익절 (1차 매도 후 추가 상승시)');
  lines.push('- 매트릭스 D/F (점수 20↓) = 매도 검토');
  lines.push('');
  lines.push('### 3. 관망');
  lines.push('- 매트릭스 C 등급 (40-60) = 관망');
  lines.push('- 거래대금 1억 미만 = 유동성 부족 매수 금지');
  lines.push('');
  lines.push('---');
  lines.push(`📅 다음 갱신: 매 거래일 17:00 KST`);
  lines.push(`🔗 https://tardisquantinvest.vercel.app`);

  // 파일 저장
  if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });
  const reportFile = path.join(DOCS_DIR, `DAILY-${today}.md`);
  fs.writeFileSync(reportFile, lines.join('\n'));
  console.log(`  ${reportFile} 저장 완료`);

  // 가장 최근 30개만 보관
  const files = fs.readdirSync(DOCS_DIR)
    .filter((f) => /^DAILY-\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort()
    .reverse();
  if (files.length > 30) {
    for (const f of files.slice(30)) {
      fs.unlinkSync(path.join(DOCS_DIR, f));
    }
    console.log(`  오래된 리포트 ${files.length - 30}개 삭제`);
  }

  console.log(`\n총 ${lines.length}줄, ${lines.join('').length}자`);
  console.log('=== 완료 ===');
}

main();
