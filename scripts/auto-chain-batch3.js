'use strict';
// batch 3차: 남은 KOSPI 422개 + KOSDAQ 767개 + EXPORT_ONLY
// auto-chain.js는 OFFSET 0이라 중복, batch3은 OFFSET 1000부터

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);
const LOG = (s) => { const line = `[batch3] ${new Date().toISOString()} ${s}`; console.log(line); fs.appendFileSync(path.join(ROOT, 'logs', 'auto-chain-batch3.log'), line + '\n'); };

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
  // 1) supply KOSPI 1000 OFFSET 1000 (KOSPI 1,000~1,422 = 422개)
  if (!runScript('supply-KOSPI-1000-OFFSET-1000', 'scripts/fetch-supply-industry.js', ['1000', 'KOSPI', '0'], { FETCH_OFFSET: '1000' })) process.exit(1);
  // 2) supply KOSDAQ 1000 OFFSET 1000 (KOSDAQ 1,000~1,767 = 767개)
  if (!runScript('supply-KOSDAQ-1000-OFFSET-1000', 'scripts/fetch-supply-industry.js', ['1000', 'KOSDAQ', '0'], { FETCH_OFFSET: '1000' })) process.exit(1);
  // 3) EXPORT_ONLY
  if (!runScript('EXPORT_ONLY', 'scripts/update.js', [], { EXPORT_ONLY: '1' })) process.exit(1);
  LOG('모두 완료');
}

main().catch((e) => { LOG(`fatal: ${e.message}`); process.exit(1); });
