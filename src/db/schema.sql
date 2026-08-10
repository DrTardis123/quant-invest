-- DuckDB 스키마 (멱등성 보장)

-- 종목 마스터
CREATE TABLE IF NOT EXISTS stocks (
  code        VARCHAR(20) PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  market      VARCHAR(20) NOT NULL,
  sector      VARCHAR(50),
  industry    VARCHAR(100),
  listed_shares BIGINT,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 일봉 (OHLCV)
CREATE TABLE IF NOT EXISTS daily_prices (
  code           VARCHAR(20) NOT NULL,
  date           DATE        NOT NULL,
  open           BIGINT,
  high           BIGINT,
  low            BIGINT,
  close          BIGINT,
  volume         BIGINT,
  trading_value  BIGINT,
  market_cap     BIGINT,
  PRIMARY KEY (code, date)
);
CREATE INDEX IF NOT EXISTS idx_daily_prices_date ON daily_prices(date);
CREATE INDEX IF NOT EXISTS idx_daily_prices_code ON daily_prices(code);

-- 재무 (분기)
CREATE TABLE IF NOT EXISTS fundamentals (
  code             VARCHAR(20) NOT NULL,
  period           VARCHAR(10) NOT NULL,  -- 예: 2025-Q1
  per              DOUBLE,
  pbr              DOUBLE,
  psr              DOUBLE,
  eps              DOUBLE,
  bps              DOUBLE,
  roe              DOUBLE,
  roa              DOUBLE,
  revenue          BIGINT,
  operating_profit BIGINT,
  net_profit       BIGINT,
  debt_ratio       DOUBLE,
  dividend_yield   DOUBLE,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (code, period)
);
CREATE INDEX IF NOT EXISTS idx_fundamentals_code ON fundamentals(code);

-- 팩터 점수 (일별)
CREATE TABLE IF NOT EXISTS factor_scores (
  code            VARCHAR(20) NOT NULL,
  date            DATE        NOT NULL,
  value_score     DOUBLE,
  momentum_score  DOUBLE,
  quality_score   DOUBLE,
  volatility_score DOUBLE,
  growth_score    DOUBLE,
  total_score     DOUBLE,
  rank            INTEGER,
  PRIMARY KEY (code, date)
);
CREATE INDEX IF NOT EXISTS idx_factor_scores_date ON factor_scores(date);
CREATE INDEX IF NOT EXISTS idx_factor_scores_rank ON factor_scores(date, rank);

-- 업데이트 로그
CREATE TABLE IF NOT EXISTS update_log (
  id              INTEGER PRIMARY KEY,
  run_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status          VARCHAR(20),
  message         TEXT,
  stocks_updated  INTEGER,
  duration_ms     INTEGER
);
