'use strict';

const fs = require('fs');
const path = require('path');
const { DuckDBInstance } = require('@duckdb/node-api');
const cfg = require('../config');

let _instance = null;
let _conn = null;
let _readOnly = false;

async function getInstance() {
  if (_instance) return _instance;
  const dbDir = path.dirname(cfg.data.dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  // read_only 모드 지원 (환경변수 DUCKDB_READ_ONLY=1)
  const ro = process.env.DUCKDB_READ_ONLY === '1';
  _readOnly = ro;
  try {
    _instance = await DuckDBInstance.create(cfg.data.dbPath, ro ? { access_mode: 'READ_ONLY' } : {});
  } catch (e) {
    if (ro) {
      console.error('[db] read_only 실패, 일반 모드 재시도:', e.message);
      _readOnly = false;
      _instance = await DuckDBInstance.create(cfg.data.dbPath);
    } else {
      throw e;
    }
  }
  return _instance;
}

async function getConnection() {
  if (_conn) return _conn;
  const inst = await getInstance();
  _conn = await inst.connect();
  return _conn;
}

async function run(sql, params) {
  const conn = await getConnection();
  // @duckdb/node-api: ? → $N 자동 변환
  if (params && params.length) {
    let i = 0;
    const converted = sql.replace(/\?/g, () => `$${++i}`);
    return await conn.run(converted, params);
  }
  return await conn.run(sql);
}

async function all(sql, params) {
  const conn = await getConnection();
  // @duckdb/node-api 는 ? 대신 $1, $2 플레이스홀더 사용.
  // ? → $N 자동 변환으로 기존 SQL 그대로 사용 가능.
  if (params && params.length) {
    let i = 0;
    const converted = sql.replace(/\?/g, () => `$${++i}`);
    return (await conn.runAndReadAll(converted, params)).getRowObjects();
  }
  return (await conn.runAndReadAll(sql)).getRowObjects();
}

async function one(sql, params) {
  const rows = await all(sql, params);
  return rows[0] || null;
}

async function close() {
  if (_conn) {
    try { _conn.closeSync?.(); } catch (_) { /* ignore */ }
    _conn = null;
  }
  _instance = null;
}

module.exports = { getInstance, getConnection, run, all, one, close };
