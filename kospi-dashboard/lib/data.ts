// 정적 JSON 로더 — Server-only (Node.js fs 사용)
// 클라이언트 컴포넌트는 lib/constants.ts의 상수/포맷터만 import

import fs from "node:fs";
import path from "node:path";

const DATA = path.join(process.cwd(), "data");

function readJSON<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA, file), "utf-8")) as T;
}

export interface Fundamental {
  ticker: string;
  name: string;
  PER: number | null;
  PBR: number | null;
  ROE: number | null;
  PSR: number | null;
  DividendYield: number | null;
  DebtEquity: number | null;
  ForeignOwnership: number | null;
  OperatingMargin: number | null;
}

export interface MonthlyFactor {
  ticker: string;
  Date: string;
  Close: string;
  momentum_12_1: string;
  log_size: string;
  volatility_60d: string;
  liquidity: string;
  mean_reversion: string;
  next_return: string;
}

export interface FactorBeta {
  YearMonth: string;
  n: number;
  r2: number;
  intercept: number;
  beta_momentum_12_1: number;
  beta_log_size: number;
  beta_volatility_60d: number;
  beta_liquidity: number;
  beta_mean_reversion: number;
  beta_PER: number;
  beta_PBR: number;
  beta_ROE: number;
  beta_PSR: number;
  beta_DividendYield: number;
  beta_DebtEquity: number;
  beta_ForeignOwnership: number;
  beta_OperatingMargin: number;
  t_momentum_12_1: number;
  t_log_size: number;
  t_volatility_60d: number;
  t_liquidity: number;
  t_mean_reversion: number;
  t_PER: number;
  t_PBR: number;
  t_ROE: number;
  t_PSR: number;
  t_DividendYield: number;
  t_DebtEquity: number;
  t_ForeignOwnership: number;
  t_OperatingMargin: number;
}

export interface Round2Summary {
  T1_train_test_excess: {
    train_excess_cagr: number;
    test_excess_cagr: number;
    overfit_ratio: number | null;
    interpretation: string;
  };
  T2_weight_stability: {
    sign_agreement: string;
    sign_agreement_pct: number;
  };
  T3_regularization: {
    OLS: { train_Sharpe: number; test_Sharpe: number; test_CAGR: number };
    Ridge: { train_Sharpe: number; test_Sharpe: number; test_CAGR: number };
    LASSO: { train_Sharpe: number; test_Sharpe: number; test_CAGR: number };
    LASSO_zeroed_factors: string[];
  };
  T4_factor_count: Record<string, any>;
  best_test_set: string;
  factors: { price: string[]; fundamental: string[] };
  "1차_vs_2차"?: Record<string, any>;
}

export function getAllFunds(): Fundamental[] {
  return readJSON<Fundamental[]>("fundamentals.json");
}

export function getFund(ticker: string): Fundamental | undefined {
  return getAllFunds().find((f) => f.ticker === ticker);
}

export function getAllMonthly(): MonthlyFactor[] {
  return readJSON<MonthlyFactor[]>("monthly_factors.json");
}

export function getMonthlyForTicker(ticker: string): MonthlyFactor[] {
  return getAllMonthly().filter((m) => m.ticker === ticker);
}

export function getAllBetas(): FactorBeta[] {
  return readJSON<FactorBeta[]>("factor_betas.json");
}

export function getSummary(): Round2Summary {
  return readJSON<Round2Summary>("round2_summary.json");
}

// Re-export for convenience (only the data shapes; client should import constants from constants.ts)
export { ALL_FACTORS, FACTOR_DESCRIPTIONS, PRICE_FACTORS, FUND_FACTORS } from "./constants";
export { fmtPct, fmtNum, fmtSharpe } from "./constants";
