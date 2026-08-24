// HMM (Hidden Markov Model) 기반 시장 regime detection
// — 2-state (risk_on, risk_off) 또는 3-state (bull/neutral/bear)
// — Baum-Welch 학습 (간이 구현, 적은 파라미터)
// — forward 알고리즘으로 regime 확률 추정
'use strict';

const db = require('../db/connection');

/**
 * HMM 2-state (Gaussian observation)
 * 파라미터:
 *   π: 초기 상태 확률 [π0, π1]
 *   A: 전이 확률 행렬 [[a00, a01], [a10, a11]]
 *   μ: 각 상태의 관측값 평균 [μ0, μ1]
 *   σ: 각 상태의 관측값 표준편차 [σ0, σ1]
 */
class HMM2 {
  constructor(obs) {
    this.obs = obs;  // 1D 관측 시계열
    this.N = obs.length;
    this.K = 2;  // states
    // 파라미터 초기화
    this.pi = [0.5, 0.5];
    this.A = [[0.95, 0.05], [0.05, 0.95]];  // 자기 상관 높게
    // 관측값 평균/표준편차로 초기화
    const m = obs.reduce((a, b) => a + b, 0) / obs.length;
    const v = obs.reduce((a, b) => a + (b - m) ** 2, 0) / obs.length;
    const sd = Math.sqrt(v);
    this.mu = [m - sd, m + sd];  // risk_off: 낮은 수익률, risk_on: 높은
    this.sigma = [sd, sd];
  }
  // Gaussian emission probability
  _emission(o, k) {
    const d = o - this.mu[k];
    return Math.exp(-0.5 * (d / this.sigma[k]) ** 2) / (this.sigma[k] * Math.sqrt(2 * Math.PI));
  }
  // Forward 알고리즘
  _forward() {
    const alpha = new Array(this.N);
    for (let t = 0; t < this.N; t++) {
      alpha[t] = new Array(this.K);
      for (let k = 0; k < this.K; k++) {
        let v;
        if (t === 0) {
          v = this.pi[k] * this._emission(this.obs[t], k);
        } else {
          v = 0;
          for (let j = 0; j < this.K; j++) {
            v += alpha[t - 1][j] * this.A[j][k];
          }
          v *= this._emission(this.obs[t], k);
        }
        alpha[t][k] = v;
      }
    }
    return alpha;
  }
  // Backward 알고리즘
  _backward() {
    const beta = new Array(this.N);
    for (let t = this.N - 1; t >= 0; t--) {
      beta[t] = new Array(this.K);
      for (let k = 0; k < this.K; k++) {
        if (t === this.N - 1) {
          beta[t][k] = 1;
        } else {
          let v = 0;
          for (let j = 0; j < this.K; j++) {
            v += this.A[k][j] * this._emission(this.obs[t + 1], j) * beta[t + 1][j];
          }
          beta[t][k] = v;
        }
      }
    }
    return beta;
  }
  // E-step: 각 시점의 상태 확률 (gamma)
  _eStep() {
    const alpha = this._forward();
    const beta = this._backward();
    const gamma = new Array(this.N);
    for (let t = 0; t < this.N; t++) {
      let sum = 0;
      for (let k = 0; k < this.K; k++) sum += alpha[t][k] * beta[t][k];
      gamma[t] = new Array(this.K);
      for (let k = 0; k < this.K; k++) {
        gamma[t][k] = sum > 0 ? (alpha[t][k] * beta[t][k]) / sum : 0.5;
      }
    }
    // xi (전이 확률): t→t+1 상태쌍 확률
    const xi = [];
    for (let t = 0; t < this.N - 1; t++) {
      const xiT = new Array(this.K);
      for (let i = 0; i < this.K; i++) {
        xiT[i] = new Array(this.K);
        for (let j = 0; j < this.K; j++) {
          let denom = 0;
          for (let a = 0; a < this.K; a++) {
            for (let b = 0; b < this.K; b++) {
              denom += alpha[t][a] * this.A[a][b] * this._emission(this.obs[t + 1], b) * beta[t + 1][b];
            }
          }
          const num = alpha[t][i] * this.A[i][j] * this._emission(this.obs[t + 1], j) * beta[t + 1][j];
          xiT[i][j] = denom > 0 ? num / denom : 0;
        }
      }
      xi.push(xiT);
    }
    return { gamma, xi };
  }
  // M-step: 파라미터 업데이트
  _mStep(gamma, xi) {
    // pi (초기 상태)
    for (let k = 0; k < this.K; k++) this.pi[k] = gamma[0][k];
    // A (전이 확률)
    for (let i = 0; i < this.K; i++) {
      let sumI = 0, sumIJ = 0;
      for (let t = 0; t < this.N - 1; t++) {
        for (let k = 0; k < this.K; k++) sumI += gamma[t][k];
        for (let j = 0; j < this.K; j++) sumIJ += xi[t][i][j];
      }
      for (let j = 0; j < this.K; j++) {
        this.A[i][j] = sumI > 0 ? (sumIJ / (this.N - 1) / sumI * (this.N - 1)) : 0.5;
      }
      // 단순화: A[i][j] = sum_xi[i][j] / sum_gamma_t[i]
      let denom = 0;
      for (let t = 0; t < this.N - 1; t++) denom += gamma[t][i];
      for (let j = 0; j < this.K; j++) {
        let num = 0;
        for (let t = 0; t < this.N - 1; t++) num += xi[t][i][j];
        this.A[i][j] = denom > 0 ? num / denom : 0.5;
      }
    }
    // μ, σ (관측 통계)
    for (let k = 0; k < this.K; k++) {
      let sumW = 0, sumWX = 0;
      for (let t = 0; t < this.N; t++) {
        sumW += gamma[t][k];
        sumWX += gamma[t][k] * this.obs[t];
      }
      this.mu[k] = sumW > 0 ? sumWX / sumW : 0;
      let sumWX2 = 0;
      for (let t = 0; t < this.N; t++) sumWX2 += gamma[t][k] * (this.obs[t] - this.mu[k]) ** 2;
      this.sigma[k] = sumW > 0 ? Math.sqrt(sumWX2 / sumW) : 1;
    }
  }
  // Baum-Welch 학습
  fit(maxIter = 20, tol = 1e-4) {
    let prevL = -Infinity;
    for (let it = 0; it < maxIter; it++) {
      const { gamma, xi } = this._eStep();
      // log-likelihood
      const alpha = this._forward();
      let L = 0;
      for (let t = 0; t < this.N; t++) {
        let s = 0;
        for (let k = 0; k < this.K; k++) s += alpha[t][k];
        L += Math.log(Math.max(s, 1e-300));
      }
      this._mStep(gamma, xi);
      if (Math.abs(L - prevL) < tol) break;
      prevL = L;
    }
  }
  // Viterbi: 가장 가능성 높은 상태 시퀀스
  predict() {
    const delta = new Array(this.N);
    const psi = new Array(this.N);
    for (let t = 0; t < this.N; t++) {
      delta[t] = new Array(this.K);
      psi[t] = new Array(this.K);
      for (let k = 0; k < this.K; k++) {
        if (t === 0) {
          delta[t][k] = Math.log(this.pi[k] + 1e-300) + Math.log(this._emission(this.obs[t], k) + 1e-300);
          psi[t][k] = 0;
        } else {
          let bestV = -Infinity, bestJ = 0;
          for (let j = 0; j < this.K; j++) {
            const v = delta[t - 1][j] + Math.log(this.A[j][k] + 1e-300);
            if (v > bestV) { bestV = v; bestJ = j; }
          }
          delta[t][k] = bestV + Math.log(this._emission(this.obs[t], k) + 1e-300);
          psi[t][k] = bestJ;
        }
      }
    }
    // backtrack
    const path = new Array(this.N);
    let bestLast = 0, bestLastV = -Infinity;
    for (let k = 0; k < this.K; k++) {
      if (delta[this.N - 1][k] > bestLastV) { bestLastV = delta[this.N - 1][k]; bestLast = k; }
    }
    path[this.N - 1] = bestLast;
    for (let t = this.N - 2; t >= 0; t--) {
      path[t] = psi[t + 1][path[t + 1]];
    }
    // 각 시점의 regime 확률 (gamma)
    const { gamma } = this._eStep();
    return { path, gamma, mu: this.mu, sigma: this.sigma, A: this.A, pi: this.pi };
  }
}

/**
 * KOSPI 일별 수익률 → HMM regime 분류
 * @param {Object} db - DuckDB connection
 * @param {Object} [options] - {startDate, endDate, lookback: 252}
 * @returns {Promise<Object>} {regimes: [{date, state, prob0, prob1}], params}
 */
async function detectRegimeHMM(db, options = {}) {
  const { startDate = '2021-08-22', endDate = null, lookback = 504 } = options;
  // 1) KOSPI 일별 수익률 로드 (KODEX 200 = 069500 사용; 인덱스 직접 데이터 부재)
  let sql = `
    SELECT date, close
    FROM daily_prices
    WHERE code = '069500' AND date >= '${startDate}'
  `;
  if (endDate) sql += ` AND date <= '${endDate}'`;
  sql += ' ORDER BY date';
  let rows = await db.all(sql);
  if (rows.length < 60) {
    throw new Error(`KODEX 200 (069500) 일별 데이터 부족: ${rows.length}행`);
  }
  // 2) 일별 log return
  const obs = [];
  const dates = [];
  for (let i = 1; i < rows.length; i++) {
    const c0 = Number(rows[i - 1].close);
    const c1 = Number(rows[i].close);
    if (c0 > 0 && c1 > 0) {
      obs.push(Math.log(c1 / c0) * 100);  // × 100 (퍼센트 단위)
      dates.push(String(rows[i].date).slice(0, 10));
    }
  }
  // 3) HMM 학습
  const hmm = new HMM2(obs);
  hmm.fit(30);
  const result = hmm.predict();
  // 4) regime 인덱스 결정: μ 높은 쪽 = risk_on, 낮은 쪽 = risk_off
  const onIdx = result.mu[0] > result.mu[1] ? 0 : 1;
  const offIdx = 1 - onIdx;
  // 5) 결과
  const regimes = result.path.map((s, i) => ({
    date: dates[i],
    state: s === onIdx ? 'risk_on' : 'risk_off',
    probOn: result.gamma[i][onIdx],
    probOff: result.gamma[i][offIdx],
    retPct: obs[i],
  }));
  return {
    regimes,
    params: {
      mu: { on: result.mu[onIdx], off: result.mu[offIdx] },
      sigma: { on: result.sigma[onIdx], off: result.sigma[offIdx] },
      A: result.A,
      pi: [result.pi[onIdx], result.pi[offIdx]],
    },
  };
}

/**
 * 현재 regime 분류 (오늘자)
 * @param {Object} db
 * @param {Object} [options]
 * @returns {Promise<Object>} {regime, probOn, probOff, muOn, muOff}
 */
async function currentRegime(db, options = {}) {
  const out = await detectRegimeHMM(db, options);
  const last = out.regimes[out.regimes.length - 1];
  return {
    regime: last.state,
    probOn: last.probOn,
    probOff: last.probOff,
    muOn: out.params.mu.on,
    muOff: out.params.mu.off,
    lastDate: last.date,
  };
}

module.exports = { HMM2, detectRegimeHMM, currentRegime };
