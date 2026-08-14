'use strict';
// 자동화 체인: refresh KOSPI → supply KOSPI → refresh KOSDAQ → supply KOSDAQ → EXPORT_ONLY
// 모두 완료되면 parent session에 결과 보고

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);
const LOG = (s) => { const line = `[chain] ${new Date().toISOString()} ${s}`; console.log(line); fs.appendFileSync(path.join(ROOT, 'logs', 'auto-chain.log'), line + '\n'); };

function runScript(label, script, args, env = {}) {
  LOG(`시작: ${label} (${script} ${args.join(' ')})`);
  const r = spawnSync('node', [script, ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...env, DUCKDB_READ_ONLY: '0' },
  });
  if (r.status !== 0) {
    LOG(`실패: ${label} (exit ${r.status})`);
    return false;
  }
  LOG(`완료: ${label}`);
  return true;
}

async function main() {
  // 1) supply KOSPI 1,000개 (refresh KOSPI는 이미 진행 중, 별도 batch)
  if (!runScript('supply-KOSPI-1000', 'scripts/fetch-supply-industry.js', ['1000', 'KOSPI', '0'], { FETCH_OFFSET: '0' })) process.exit(1);
  // 2) refresh KOSDAQ 828개
  if (!runScript('refresh-KOSDAQ-828', 'scripts/refresh-fundamentals-full.js', ['828', '0', 'KOSDAQ'])) process.exit(1);
  // 3) supply KOSDAQ 1,000개
  if (!runScript('supply-KOSDAQ-1000', 'scripts/fetch-supply-industry.js', ['1000', 'KOSDAQ', '0'], { FETCH_OFFSET: '0' })) process.exit(1);
  // 4) EXPORT_ONLY
  if (!runScript('EXPORT_ONLY', 'scripts/update.js', [], { EXPORT_ONLY: '1' })) process.exit(1);
  LOG('모두 완료');
}

main().catch((e) => { LOG(`fatal: ${e.message}`); process.exit(1); });
