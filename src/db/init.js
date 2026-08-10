'use strict';

const fs = require('fs');
const path = require('path');
const { run } = require('./connection');

async function initSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  // DuckDB는 여러 statement를 한 번에 실행 가능하지만 안전하게 split
  const stmts = sql
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const s of stmts) {
    await run(s);
  }
}

module.exports = { initSchema };
