// 클라이언트/서버 양쪽에서 import 가능한 상수/타입 (Node.js API 사용 X)

export const PRICE_FACTORS = ["momentum_12_1", "log_size", "volatility_60d", "liquidity", "mean_reversion"] as const;
export const FUND_FACTORS = ["PER", "PBR", "ROE", "PSR", "DividendYield", "DebtEquity", "ForeignOwnership", "OperatingMargin"] as const;
export const ALL_FACTORS = [...PRICE_FACTORS, ...FUND_FACTORS] as const;

export const FACTOR_DESCRIPTIONS: Record<string, string> = {
  momentum_12_1: "12개월 모멘텀 (skip 1개월)",
  log_size: "log(시가총액)",
  volatility_60d: "60일 변동성",
  liquidity: "20일 거래대금/시총",
  mean_reversion: "1 - Close/52주고가",
  PER: "PER (주가/EPS)",
  PBR: "PBR (주가/순자산)",
  ROE: "ROE (당기순이익/자기자본)",
  PSR: "PSR (시총/매출)",
  DividendYield: "배당수익률",
  DebtEquity: "부채비율",
  ForeignOwnership: "외국인 지분율",
  OperatingMargin: "영업이익률",
};

export const FACTOR_COLORS: Record<string, string> = {
  momentum_12_1: "#3b82f6",
  log_size: "#10b981",
  volatility_60d: "#f59e0b",
  liquidity: "#8b5cf6",
  mean_reversion: "#ef4444",
  PER: "#06b6d4",
  PBR: "#84cc16",
  ROE: "#eab308",
  PSR: "#f97316",
  DividendYield: "#ec4899",
  DebtEquity: "#14b8a6",
  ForeignOwnership: "#a855f7",
  OperatingMargin: "#d946ef",
};

export function fmtPct(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}

export function fmtNum(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return x.toFixed(digits);
}

export function fmtSharpe(x: number | null | undefined): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return x.toFixed(2);
}
