// 일일 파이프라인 통합 실행 (GitHub Actions + 로컬 수동)
// 1. 데이터 fetch → 2. 신호 생성 → 3. 손절/익절 알림 → 4. 신호 추적 → 5. 일일 리포트
'use strict';
process.chdir('C:/Users/LG/Documents/quant_invest');
delete process.env.DUCKDB_READ_ONLY;

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const SCRIPTS = path.join(__dirname);

function runScript(name) {
  const scriptPath = path.join(SCRIPTS, name);
  console.log(`\n[실행] ${name}...`);
  try {
    execSync(`node "${scriptPath}"`, { stdio: 'inherit', cwd: 'C:/Users/LG/Documents/quant_invest' });
    return true;
  } catch (e) {
    console.error(`  실패: ${e.message}`);
    return false;
  }
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`=== 일일 파이프라인 (${today}) ===\n`);

  const tasks = process.argv.slice(2);
  const pipeline = tasks.length > 0 ? tasks : [
    'update.js',
    'daily-signals.js',
    'stop-alert.js',
    'track-signals.js',
    'daily-report.js',
    'backup-db.js',
  ];

  let success = 0, fail = 0;
  for (const task of pipeline) {
    if (runScript(task)) {
      success++;
    } else {
      fail++;
      console.log(`  ⚠️ ${task} 실패 (계속 진행)`);
    }
  }

  console.log(`\n=== 파이프라인 완료 ===`);
  console.log(`  성공: ${success} / ${pipeline.length}`);
  console.log(`  실패: ${fail}`);
  if (fail > 0) {
    process.exit(1);
  }
}

main().catch((e) => { console.error('fatal:', e); process.exit(1); });
