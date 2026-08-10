// Vercel Function: /api/backtest
// 호스팅 버전에서는 정적 데이터 한계로 백테스트 불가.
// (DuckDB 가 Vercel Functions 에서 동작하지 않고, 정적 JSON 은 단일 스냅샷만 있음)
// → 로컬에서 npm run backtest 사용 안내

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: false,
    hosted: true,
    error: '백테스트는 호스팅 버전에서 지원되지 않습니다. 로컬에서 npm run dev 후 http://localhost:3000 의 백테스트 탭을 사용하세요.',
  });
};
