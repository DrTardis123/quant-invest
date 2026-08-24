// DuckDB 일일 백업 (cron용)
'use strict';
process.chdir('C:/Users/LG/Documents/quant_invest');

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'quant.db');
const BACKUP_DIR = path.join(__dirname, '..', 'data');

function main() {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`=== DuckDB 일일 백업 (${today}) ===\n`);

  if (!fs.existsSync(DB_PATH)) {
    console.log(`  DB 파일 없음: ${DB_PATH}`);
    return;
  }
  const backupFile = path.join(BACKUP_DIR, `quant.db.backup-${today}`);
  // DuckDB는 실행 중 복사 가능 (WAL 일관성 보장)
  fs.copyFileSync(DB_PATH, backupFile);
  const stat = fs.statSync(backupFile);
  console.log(`  ${backupFile} (${(stat.size / 1024 / 1024).toFixed(1)}MB) 생성 완료`);

  // 30일 이상된 백업 자동 삭제
  const cutoffDays = 30;
  const cutoff = Date.now() - cutoffDays * 86400000;
  const backups = fs.readdirSync(BACKUP_DIR)
    .filter((f) => /^quant\.db\.backup-\d{4}-\d{2}-\d{2}$/.test(f))
    .map((f) => ({
      file: f,
      path: path.join(BACKUP_DIR, f),
      mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtime,
    }));
  let deleted = 0;
  for (const b of backups) {
    if (b.mtime.getTime() < cutoff) {
      fs.unlinkSync(b.path);
      deleted++;
      console.log(`  ${b.file} 삭제 (>${cutoffDays}일)`);
    }
  }
  console.log(`  백업 보관: ${backups.length - deleted}개 (${cutoffDays}일 이내)`);
  console.log('=== 완료 ===');
}

main();
