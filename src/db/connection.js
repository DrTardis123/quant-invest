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
  if (params && params.length) {
    const stmt = await conn.prepare(sql);
    try {
      const res = await stmt.run(...params);
      return res;
    } finally {
      stmt.closeSync?.();
    }
  }
  await conn.run(sql);
}

async function all(sql, params) {
  const conn = await getConnection();
  if (params && params.length) {
    const stmt = await conn.prepare(sql);
    try {
      const reader = await stmt.runAndReadAll(...params);
      return reader.getRowObjects();
    } finally {
      stmt.closeSync?.();
    }
  }
  const reader = await conn.runAndReadAll(sql);
  return reader.getRowObjects();
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
