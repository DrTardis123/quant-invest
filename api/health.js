// Vercel Function: /api/health
// 호스팅 버전의 상태 확인 (데이터 신선도, GitHub Actions 마지막 실행)

const { readFileSync, existsSync } = require('fs');
const path = require('path');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const result = {
    ok: true,
    hosted: true,
    now: new Date().toISOString(),
  };

  // 마지막 데이터 갱신 시각 (log.json 의 최신 entry)
  const logPath = path.join(process.cwd(), 'public', 'data', 'log.json');
  if (existsSync(logPath)) {
    try {
      const logs = JSON.parse(readFileSync(logPath, 'utf8'));
      if (logs.length > 0) {
        result.lastUpdate = logs[0].run_at;
        result.lastStatus = logs[0].status;
      }
    } catch (e) { /* ignore */ }
  }

  // 마지막 가격일 (meta.json)
  const metaPath = path.join(process.cwd(), 'public', 'data', 'meta.json');
  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      result.lastPriceDate = meta.last_price_date || null;
      result.lastScoreDate = meta.last_score_date || null;
      result.stockCount = meta.stock_count || 0;
    } catch (e) { /* ignore */ }
  }

  res.status(200).send(JSON.stringify(result));
};
