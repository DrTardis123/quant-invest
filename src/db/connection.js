'use strict';

const fs = require('fs');
const path = require('path');
const { DuckDBInstance } = require('@duckdb/node-api');
const cfg = require('../config');

let _instance = null;
let _conn = null;

async function getInstance() {
  if (_instance) return _instance;
  const dbDir = path.dirname(cfg.data.dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  _instance = await DuckDBInstance.create(cfg.data.dbPath);
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
