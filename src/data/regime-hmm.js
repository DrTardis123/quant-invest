// HMM (Hidden Markov Model) 기반 시장 regime detection
// — K-state Gaussian HMM (3-state: low vol / mid vol / high vol)
// — KODEX 200 (069500) weekly resample → 변동성 평탄화
// — multi-feature: returns + rolling vol + volume change
// — Baum-Welch 학습 + Viterbi 디코딩
'use strict';

const db = require('../db/connection');

/**
 * K-state Gaussian HMM (1D 관측값)
 * 파라미터:
 *   π: 초기 상태 확률 (K개)
 *   A: 전이 확률 행렬 (K×K)
 *   μ: 각 상태의 관측값 평균 (K개)
 *   σ: 각 상태의 관측값 표준편차 (K개)
 */
class HMMK {
  constructor(obs, K = 3) {
    this.obs = obs;
    this.N = obs.length;
    this.K = K;
    // K-means 같은 초기화: 관측값을 K등분 quantile로 나눔
    const sorted = [...obs].sort((a, b) => a - b);
    this.pi = new Array(K).fill(1 / K);
    this.A = [];
    for (let i = 0; i < K; i++) {
      this.A.push(new Array(K).fill(1 / K));
    }
    // 자기 상관 높게: 대각 0.9, 비대각 (0.1/(K-1))
    for (let i = 0; i < K; i++) {
      for (let j = 0; j < K; j++) {
        this.A[i][j] = i === j ? 0.9 : 0.1 / (K - 1);
      }
    }
    // μ: quantile 초기화 (low / mid / high)
    this.mu = [];
    for (let k = 0; k < K; k++) {
      const q = (k + 0.5) / K;
      const idx = Math.floor(q * sorted.length);
      this.mu.push(sorted[Math.min(idx, sorted.length - 1)]);
    }
    // σ: 전체 표준편차
    const m = obs.reduce((a, b) => a + b, 0) / obs.length;
    const sd = Math.sqrt(obs.reduce((a, b) => a + (b - m) ** 2, 0) / obs.length);
    this.sigma = new Array(K).fill(Math.max(sd * 0.5, 0.01));
  }

  _emission(o, k) {
    const d = o - this.mu[k];
    const s = this.sigma[k];
    return Math.exp(-0.5 * (d / s) ** 2) / (s * Math.sqrt(2 * Math.PI));
  }

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

  _eStep() {
    const alpha = this._forward();
    const beta = this._backward();
    const gamma = new Array(this.N);
    for (let t = 0; t < this.N; t++) {
      let sum = 0;
      for (let k = 0; k < this.K; k++) sum += alpha[t][k] * beta[t][k];
      gamma[t] = new Array(this.K);
      for (let k = 0; k < this.K; k++) {
        gamma[t][k] = sum > 0 ? (alpha[t][k] * beta[t][k]) / sum : 1 / this.K;
      }
    }
    // xi
    const xi = [];
    for (let t = 0; t < this.N - 1; t++) {
      const xiT = [];
      let denom = 0;
      for (let i = 0; i < this.K; i++) {
        for (let j = 0; j < this.K; j++) {
          denom += alpha[t][i] * this.A[i][j] * this._emission(this.obs[t + 1], j) * beta[t + 1][j];
        }
      }
      for (let i = 0; i < this.K; i++) {
        xiT.push([]);
        for (let j = 0; j < this.K; j++) {
          const num = alpha[t][i] * this.A[i][j] * this._emission(this.obs[t + 1], j) * beta[t + 1][j];
          xiT[i].push(denom > 0 ? num / denom : 0);
        }
      }
      xi.push(xiT);
    }
    return { gamma, xi, logLikelihood: this._logLikelihood(alpha) };
  }

  _logLikelihood(alpha) {
    let L = 0;
    for (let t = 0; t < this.N; t++) {
      let s = 0;
      for (let k = 0; k < this.K; k++) s += alpha[t][k];
      L += Math.log(Math.max(s, 1e-300));
    }
    return L;
  }

  _mStep(gamma, xi) {
    // pi
    for (let k = 0; k < this.K; k++) this.pi[k] = gamma[0][k];
    // A
    for (let i = 0; i < this.K; i++) {
      let denom = 0;
      for (let t = 0; t < this.N - 1; t++) denom += gamma[t][i];
      for (let j = 0; j < this.K; j++) {
        let num = 0;
        for (let t = 0; t < this.N - 1; t++) num += xi[t][i][j];
        this.A[i][j] = denom > 0 ? num / denom : 1 / this.K;
      }
    }
    // μ, σ
    for (let k = 0; k < this.K; k++) {
      let sumW = 0, sumWX = 0;
      for (let t = 0; t < this.N; t++) {
        sumW += gamma[t][k];
        sumWX += gamma[t][k] * this.obs[t];
      }
      this.mu[k] = sumW > 0 ? sumWX / sumW : 0;
      let sumWX2 = 0;
      for (let t = 0; t < this.N; t++) sumWX2 += gamma[t][k] * (this.obs[t] - this.mu[k]) ** 2;
      this.sigma[k] = sumW > 0 ? Math.max(Math.sqrt(sumWX2 / sumW), 0.01) : 0.01;
    }
  }

  fit(maxIter = 50, tol = 1e-5) {
    let prevL = -Infinity;
    let converged = false;
    let iter = 0;
    for (let it = 0; it < maxIter; it++) {
      iter = it;
      const { gamma, xi, logLikelihood } = this._eStep();
      this._mStep(gamma, xi);
      if (Math.abs(logLikelihood - prevL) < tol && it > 5) {
        converged = true;
        break;
      }
      prevL = logLikelihood;
    }
    return { converged, iter, logLikelihood: prevL };
  }

  predict() {
    // Viterbi
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
    const path = new Array(this.N);
    let bestLast = 0, bestLastV = -Infinity;
    for (let k = 0; k < this.K; k++) {
      if (delta[this.N - 1][k] > bestLastV) { bestLastV = delta[this.N - 1][k]; bestLast = k; }
    }
    path[this.N - 1] = bestLast;
    for (let t = this.N - 2; t >= 0; t--) {
      path[t] = psi[t + 1][path[t + 1]];
    }
    const { gamma } = this._eStep();
    return { path, gamma, mu: this.mu, sigma: this.sigma, A: this.A, pi: this.pi };
  }
}

/**
 * HMM 2-state (기존 호환)
 */
class HMM2 {
  constructor(obs) {
    this.obs = obs;
    this.N = obs.length;
    this.K = 2;
    this.pi = [0.5, 0.5];
    this.A = [[0.95, 0.05], [0.05, 0.95]];
    const m = obs.reduce((a, b) => a + b, 0) / obs.length;
    const sd = Math.sqrt(obs.reduce((a, b) => a + (b - m) ** 2, 0) / obs.length);
    this.mu = [m - sd, m + sd];
    this.sigma = [sd, sd];
  }
  _emission(o, k) {
    const d = o - this.mu[k];
    return Math.exp(-0.5 * (d / this.sigma[k]) ** 2) / (this.sigma[k] * Math.sqrt(2 * Math.PI));
  }
  _forward() {
    const alpha = new Array(this.N);
    for (let t = 0; t < this.N; t++) {
      alpha[t] = [0, 0];
      for (let k = 0; k < 2; k++) {
        if (t === 0) {
          alpha[t][k] = this.pi[k] * this._emission(this.obs[t], k);
        } else {
          let v = 0;
          for (let j = 0; j < 2; j++) v += alpha[t - 1][j] * this.A[j][k];
          alpha[t][k] = v * this._emission(this.obs[t], k);
        }
      }
    }
    return alpha;
  }
  _backward() {
    const beta = new Array(this.N);
    for (let t = this.N - 1; t >= 0; t--) {
      beta[t] = [1, 1];
      if (t < this.N - 1) {
        for (let k = 0; k < 2; k++) {
          let v = 0;
          for (let j = 0; j < 2; j++) {
            v += this.A[k][j] * this._emission(this.obs[t + 1], j) * beta[t + 1][j];
          }
          beta[t][k] = v;
        }
      }
    }
    return beta;
  }
  _eStep() {
    const alpha = this._forward();
    const beta = this._backward();
    const gamma = new Array(this.N);
    for (let t = 0; t < this.N; t++) {
      let sum = alpha[t][0] * beta[t][0] + alpha[t][1] * beta[t][1];
      gamma[t] = [sum > 0 ? (alpha[t][0] * beta[t][0]) / sum : 0.5,
                  sum > 0 ? (alpha[t][1] * beta[t][1]) / sum : 0.5];
    }
    return { gamma, logLikelihood: 0 };
  }
  _mStep(gamma) {
    for (let k = 0; k < 2; k++) {
      let sw = 0, swx = 0;
      for (let t = 0; t < this.N; t++) { sw += gamma[t][k]; swx += gamma[t][k] * this.obs[t]; }
      this.mu[k] = sw > 0 ? swx / sw : 0;
      let swx2 = 0;
      for (let t = 0; t < this.N; t++) swx2 += gamma[t][k] * (this.obs[t] - this.mu[k]) ** 2;
      this.sigma[k] = sw > 0 ? Math.max(Math.sqrt(swx2 / sw), 0.01) : 0.01;
    }
  }
  fit(maxIter = 30) {
    for (let it = 0; it < maxIter; it++) {
      const { gamma } = this._eStep();
      this._mStep(gamma);
    }
  }
  predict() {
    const { gamma } = this._eStep();
    return { path: gamma.map((g) => (g[0] > g[1] ? 0 : 1)), gamma, mu: this.mu, sigma: this.sigma, A: this.A, pi: this.pi };
  }
}

/**
 * KODEX 200 (069500) 일별 → 주간 리샘플 + multi-feature
 * features: weekly return, weekly volatility (5d rolling), volume z-score
 * → 1D observation: vol-weighted return (returns / volatility)
 *   = Sharpe-like signal, 변동성 평탄화
 */
async function loadKodexFeatures(db, options = {}) {
  const { startDate = '2020-01-01', endDate = null } = options;
  let sql = `
    SELECT date, close, volume
    FROM daily_prices
    WHERE code = '069500' AND date >= '${startDate}'
  `;
  if (endDate) sql += ` AND date <= '${endDate}'`;
  sql += ' ORDER BY date';
  const rows = await db.all(sql);
  if (rows.length < 60) {
    throw new Error(`KODEX 200 데이터 부족: ${rows.length}행`);
  }
  // daily log return + 5d rolling std
  const daily = [];
  for (let i = 0; i < rows.length; i++) {
    const r = i > 0 ? Math.log(Number(rows[i].close) / Number(rows[i - 1].close)) * 100 : 0;
    daily.push({ date: String(rows[i].date).slice(0, 10), ret: r, volume: Number(rows[i].volume) });
  }
  // 5d rolling std (volatility)
  for (let i = 0; i < daily.length; i++) {
    if (i < 5) {
      daily[i].vol = Math.abs(daily[i].ret);  // 단일 값이면 절대값
    } else {
      const win = daily.slice(i - 5, i).map((d) => d.ret);
      const m = win.reduce((a, b) => a + b, 0) / 5;
      const v = Math.sqrt(win.reduce((a, b) => a + (b - m) ** 2, 0) / 5);
      daily[i].vol = Math.max(v, 0.05);
    }
  }
  // weekly resample (5 trading days)
  const weekly = [];
  for (let i = 4; i < daily.length; i += 5) {
    const w = daily.slice(Math.max(0, i - 4), i + 1);
    const weekRet = w.reduce((a, b) => a + b.ret, 0);  // sum
    const weekVol = w.reduce((a, b) => a + b.vol, 0) / w.length;  // avg
    const volAvg = weekVol > 0 ? weekVol : 0.5;
    weekly.push({
      date: daily[i].date,
      ret: weekRet,
      vol: weekVol,
      sharpeLike: weekRet / volAvg,  // 변동성 평탄화
    });
  }
  return { daily, weekly };
}

/**
 * 3-state HMM regime detection (KODEX 200 weekly)
 * @param {Object} db
 * @param {Object} [options]
 * @returns {Promise<Object>} {regimes, params, features, fitInfo}
 */
async function detectRegimeHMM3(db, options = {}) {
  const { startDate = '2020-01-01', endDate = null, feature = 'sharpeLike', K = 3 } = options;
  const { weekly } = await loadKodexFeatures(db, { startDate, endDate });
  const obs = weekly.map((w) => w[feature]);
  if (obs.length < 30) {
    throw new Error(`주간 데이터 부족: ${obs.length}주`);
  }
  const hmm = new HMMK(obs, K);
  const fitInfo = hmm.fit(50, 1e-5);
  const result = hmm.predict();
  // regime 인덱스 결정: μ 기준으로 정렬 (low → mid → high)
  // 변동성 regime의 경우 |μ| 또는 σ 기준으로 low/mid/high
  const order = result.mu.map((m, i) => ({ i, mu: m, sig: result.sigma[i] }))
    .sort((a, b) => Math.abs(a.mu) - Math.abs(b.mu));
  // |μ| 가장 작은 게 low-vol regime
  const lowIdx = order[0].i;
  const highIdx = order[order.length - 1].i;
  const midIdx = order[1].i;
  // regime 이름 매핑
  const stateNames = { [lowIdx]: 'low_vol', [midIdx]: 'mid_vol', [highIdx]: 'high_vol' };
  // daily date로 변환: weekly date를 그 주의 마지막 거래일로 매핑
  // regimes 배열의 길이는 weekly.length와 동일
  const regimes = weekly.map((w, i) => {
    const state = stateNames[result.path[i]];
    const probs = {
      low_vol: result.gamma[i][lowIdx],
      mid_vol: result.gamma[i][midIdx],
      high_vol: result.gamma[i][highIdx],
    };
    return {
      date: w.date,
      state,
      probs,
      retPct: w.ret,
      vol: w.vol,
      sharpeLike: w.sharpeLike,
    };
  });
  return {
    regimes,
    features: weekly,
    fitInfo,
    params: {
      K,
      mu: { low_vol: result.mu[lowIdx], mid_vol: result.mu[midIdx], high_vol: result.mu[highIdx] },
      sigma: { low_vol: result.sigma[lowIdx], mid_vol: result.sigma[midIdx], high_vol: result.sigma[highIdx] },
      A: result.A,
    },
  };
}

/**
 * 2-state HMM (기존 호환, daily return)
 */
async function detectRegimeHMM(db, options = {}) {
  const { startDate = '2021-08-22', endDate = null, lookback = 504 } = options;
  const { daily } = await loadKodexFeatures(db, { startDate, endDate });
  const obs = daily.slice(1).map((d) => d.ret);
  const dates = daily.slice(1).map((d) => d.date);
  if (obs.length < 60) {
    throw new Error(`KODEX 200 데이터 부족: ${obs.length}행`);
  }
  const hmm = new HMMK(obs, 2);
  hmm.fit(30);
  const result = hmm.predict();
  const onIdx = result.mu[0] > result.mu[1] ? 0 : 1;
  const offIdx = 1 - onIdx;
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
 */
async function currentRegime(db, options = {}) {
  const out = await detectRegimeHMM3(db, options);
  const last = out.regimes[out.regimes.length - 1];
  return {
    regime: last.state,
    probs: last.probs,
    muLow: out.params.mu.low_vol,
    muMid: out.params.mu.mid_vol,
    muHigh: out.params.mu.high_vol,
    lastDate: last.date,
    fitInfo: out.fitInfo,
  };
}

module.exports = { HMM2, HMMK, detectRegimeHMM, detectRegimeHMM3, currentRegime, loadKodexFeatures };
