'use strict';

const express = require('express');
const db = require('../../db/connection');
const cfg = require('../../config');
const strategies = require('../../strategies');
const scoring = require('../../scoring');
const indices = require('../../data/indices');
const { exportOptimizer } = require('../../scoring/optimizer');
const { backtest } = require('../../scoring/backtest');

const router = express.Router();

// BigInt → Number 변환 (DuckDB가 큰 정수를 BigInt로 반환할 때 대비)
function toPlain(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return Number(obj);
  if (Array.isArray(obj)) return obj.map(toPlain);
  if (typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj)) out[k] = toPlain(obj[k]);
    return out;
  }
  return obj;
}

function send(res, data) { res.json(toPlain(data)); }

// 헬스 체크
router.get('/health', async (_req, res) => {
  try {
    const row = await db.one(`SELECT MAX(date) AS last_date FROM daily_prices`);
    send(res, {
      ok: true,
      dataSource: cfg.data.source,
      kisEnabled: cfg.isKisEnabled(),
      lastDate: row?.last_date || null,
      now: new Date().toISOString(),
    });
  } catch (e) {
    send(res, { ok: false, error: e.message });
  }
});

// 한국 주요 지수 (KOSPI / KOSDAQ / KOSPI200)
router.get('/indices', async (_req, res) => {
  try {
    const data = await indices.getAllIndices();
    send(res, data);
  } catch (e) {
    send(res, { ok: false, error: e.message });
  }
});

// 전략 프로파일 목록
router.get('/strategies', (_req, res) => {
  send(res, { ok: true, strategies: strategies.list(), current: strategies.defaultKey() });
});

// 현재 가중치 (전략 프로파일에 따라 결정)
router.get('/weights', (req, res) => {
  const key = req.query.key || strategies.defaultKey();
  const s = strategies.get(key);
  send(res, { ok: true, key: s.key, name: s.name, weights: s.weights, description: s.description });
});

// 최신 점수 Top N
router.get('/top', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || cfg.data.topN, 200);
  const strategyKey = req.query.strategy || strategies.defaultKey();
  const W = strategies.get(strategyKey).weights;
  try {
    const rows = await db.all(`
      SELECT fs.rank, fs.code, s.name, s.market, s.sector,
             fs.value_score, fs.momentum_score, fs.quality_score,
             fs.volatility_score, fs.growth_score, fs.total_score, fs.date
      FROM factor_scores fs
      JOIN stocks s ON s.code = fs.code
      WHERE fs.date = (SELECT MAX(date) FROM factor_scores)
      ORDER BY fs.rank
      LIMIT ?
    `, [limit]);
    const reranked = scoring.recomputeWithWeights(rows, W);
    const out = reranked.slice(0, limit).map((r) => ({
      ...r,
      total_score: r.recomputed_total,
      rank: r.recomputed_rank,
      grade: scoring.gradeFor(r.recomputed_total),
    }));
    send(res, { ok: true, asOf: rows[0]?.date || null, count: out.length, strategy: strategyKey, rows: out });
  } catch (e) {
    send(res, { ok: false, error: e.message });
  }
});

// 전체 점수 (페이지네이션, 시장/섹터 필터)
router.get('/scores', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const market = req.query.market;
  const sector = req.query.sector;
  const strategyKey = req.query.strategy || strategies.defaultKey();
  const W = strategies.get(strategyKey).weights;
  try {
    let where = `WHERE fs.date = (SELECT MAX(date) FROM factor_scores)`;
    const params = [];
    if (market) { where += ' AND s.market = ?'; params.push(market); }
    if (sector) { where += ' AND s.sector = ?'; params.push(sector); }
    const rows = await db.all(`
      SELECT fs.rank, fs.code, s.name, s.market, s.sector, s.industry,
             fs.value_score, fs.momentum_score, fs.quality_score,
             fs.volatility_score, fs.growth_score, fs.total_score
      FROM factor_scores fs
      JOIN stocks s ON s.code = fs.code
      ${where}
      ORDER BY fs.rank
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);
    const total = (await db.one(`SELECT COUNT(*) AS c FROM factor_scores fs JOIN stocks s ON s.code=fs.code ${where}`, params))?.c || 0;
    const reranked = scoring.recomputeWithWeights(rows, W);
    const out = reranked.map((r) => ({
      ...r,
      total_score: r.recomputed_total,
      rank: r.recomputed_rank,
      grade: scoring.gradeFor(r.recomputed_total),
    }));
    send(res, { ok: true, count: out.length, total, strategy: strategyKey, rows: out });
  } catch (e) {
    send(res, { ok: false, error: e.message });
  }
});

// 종목 상세
router.get('/stock/:code', async (req, res) => {
  const { code } = req.params;
  try {
    const stock = await db.one(`SELECT * FROM stocks WHERE code = ?`, [code]);
    if (!stock) return send(res, { ok: false, error: 'not found' });
    const score = await db.one(`
      SELECT * FROM factor_scores
      WHERE code = ? AND date = (SELECT MAX(date) FROM factor_scores WHERE code = ?)`, [code, code]);
    const fund = await db.all(`
      SELECT * FROM fundamentals WHERE code = ? ORDER BY period DESC LIMIT 8`, [code]);
    const prices = await db.all(`
      SELECT date, close, volume FROM daily_prices WHERE code = ?
      ORDER BY date DESC LIMIT 250`, [code]);
    const total = score?.total_score || 0;
    send(res, {
      ok: true,
      stock,
      score: score ? { ...score, grade: scoring.gradeFor(total) } : null,
      fundamentals: fund,
      prices,
    });
  } catch (e) {
    send(res, { ok: false, error: e.message });
  }
});

// 시장/섹터 메타
router.get('/meta', async (_req, res) => {
  try {
    const markets = await db.all(`SELECT DISTINCT market FROM stocks ORDER BY market`);
    const sectors = await db.all(`SELECT DISTINCT sector FROM stocks WHERE sector IS NOT NULL ORDER BY sector`);
    const stats = await db.one(`
      SELECT
        (SELECT COUNT(*) FROM stocks WHERE market IN ('KOSPI','KOSDAQ')) AS stocks,
        (SELECT MAX(date) FROM daily_prices) AS last_price_date,
        (SELECT MAX(date) FROM factor_scores) AS last_score_date,
        (SELECT MAX(run_at) FROM update_log) AS last_update
    `);
    send(res, { ok: true, markets: markets.map((m) => m.market), sectors: sectors.map((s) => s.sector), stats });
  } catch (e) {
    send(res, { ok: false, error: e.message });
  }
});

// 점수 분포 (히스토그램용)
router.get('/distribution', async (_req, res) => {
  try {
    const rows = await db.all(`
      WITH latest AS (SELECT MAX(date) AS d FROM factor_scores)
      SELECT total_score FROM factor_scores, latest WHERE date = latest.d
    `);
    send(res, { ok: true, scores: rows.map((r) => r.total_score) });
  } catch (e) {
    send(res, { ok: false, error: e.message });
  }
});

// 섹터 점수
router.get('/sectors', async (_req, res) => {
  try {
    const sectors = await scoring.getSectorScores();
    const markets = await scoring.getMarketScores();
    send(res, { ok: true, sectors, markets });
  } catch (e) {
    send(res, { ok: false, error: e.message });
  }
});

// 시총 히트맵
router.get('/heatmap', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 80, 200);
  try {
    const rows = await scoring.getHeatmap({ limit });
    send(res, { ok: true, count: rows.length, rows });
  } catch (e) {
    send(res, { ok: false, error: e.message });
  }
});

// 팩터 상관관계
router.get('/correlation', async (_req, res) => {
  try {
    const data = await scoring.getFactorCorrelation();
    send(res, { ok: true, keys: data.keys, matrix: data.matrix });
  } catch (e) {
    send(res, { ok: false, error: e.message });
  }
});

// 간단 백테스트
router.get('/backtest', async (req, res) => {
  const topN = Math.min(Math.max(Number(req.query.topN) || 20, 5), 50);
  const months = Math.min(Math.max(Number(req.query.months) || 12, 3), 24);
  try {
    const result = await scoring.backtest({ topN, lookbackMonths: months });
    send(res, result);
  } catch (e) {
    send(res, { ok: false, error: e.message });
  }
});

// 업데이트 로그
router.get('/log', async (_req, res) => {
  try {
    const rows = await db.all(`SELECT * FROM update_log ORDER BY id DESC LIMIT 20`);
    send(res, { ok: true, rows });
  } catch (e) {
    send(res, { ok: false, error: e.message });
  }
});

// 가중치 최적화 (로컬 전용 — 호스팅은 정적 JSON)
router.get('/optimizer', async (_req, res) => {
  try {
    const result = await exportOptimizer();
    send(res, result);
  } catch (e) {
    send(res, { ok: false, error: e.message });
  }
});

// 백테스트 (4개 차트, 로컬 전용)
router.get('/backtest', async (req, res) => {
  try {
    const topN = Math.min(Math.max(Number(req.query.topN) || 20, 5), 50);
    const months = Math.min(Math.max(Number(req.query.months) || 24, 3), 24);
    const result = await backtest({ topN, lookbackMonths: months });
    send(res, result);
  } catch (e) {
    send(res, { ok: false, error: e.message });
  }
});

// 수동 갱신 트리거
router.post('/update', async (_req, res) => {
  try {
    const jobs = require('../../scheduler/jobs');
    send(res, { ok: true, message: '업데이트 시작됨' });
    jobs.runUpdate().catch((e) => console.error('[api] update failed', e));
  } catch (e) {
    send(res, { ok: false, error: e.message });
  }
});

module.exports = router;
