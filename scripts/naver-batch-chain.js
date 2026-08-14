'use strict';
// fetch-naver-5y.js를 3 batch (offset 0, 100, 200) 순차 실행
// 각 batch 후 EXPORT_ONLY로 stock/*.json 갱신

const { spawnSync } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

function runScript(script, args, env = {}) {
  console.log(`\n[chain] 실행: ${script} ${args.join(' ')}`);
  const r = spawnSync('node', [script, ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) {
    console.error(`[chain] ${script} 실패: ${r.status}`);
    return false;
  }
  return true;
}

async function main() {
  // Batch 1: 0~100
  if (!runScript('scripts/fetch-naver-5y.js', ['100', '2', '0'], { DUCKDB_READ_ONLY: '0' })) process.exit(1);
  // Batch 2: 100~200
  if (!runScript('scripts/fetch-naver-5y.js', ['100', '2', '100'], { DUCKDB_READ_ONLY: '0' })) process.exit(1);
  // Batch 3: 200~300
  if (!runScript('scripts/fetch-naver-5y.js', ['100', '2', '200'], { DUCKDB_READ_ONLY: '0' })) process.exit(1);
  // Batch 4: 300~400
  if (!runScript('scripts/fetch-naver-5y.js', ['100', '2', '300'], { DUCKDB_READ_ONLY: '0' })) process.exit(1);
  // EXPORT_ONLY로 stock/*.json + json 갱신
  if (!runScript('scripts/update.js', [], { DUCKDB_READ_ONLY: '0', EXPORT_ONLY: '1' })) process.exit(1);
  console.log('\n[chain] 모두 완료');
}

main().catch((e) => { console.error(e); process.exit(1); });
