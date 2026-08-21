'use strict';

// Vercel Serverless: /api/stock/:code
// - stock/*.json은 정적 deploy에서 제외 (.vercelignore)
// - github raw에서 동적 fetch + CDN 캐시

const GITHUB_RAW = 'https://raw.githubusercontent.com/DrTardis123/quant-invest/main';

module.exports = async (req, res) => {
  // URL path에서 code 추출 (e.g., /api/stock/005930)
  const match = req.url.match(/\/api\/stock\/(\d{6})/);
  const code = match?.[1];

  if (!code) {
    res.status(400).json({ error: 'invalid code (6자리 숫자)' });
    return;
  }

  const url = `${GITHUB_RAW}/public/data/stock/${code}.json`;

  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) {
      if (r.status === 404) {
        res.status(404).json({ error: `not found: ${code}` });
        return;
      }
      res.status(r.status).json({ error: `github fetch failed: ${r.status}` });
      return;
    }
    const data = await r.json();

    // 이 함수는 MISS 마다 콜드스타트 + GitHub raw 왕복(실측 ~1.2s)을 문다.
    // 종목 상세 JSON 은 일 1회만 갱신되므로 엣지에서 하루 잡아두고,
    // 만료 후에도 SWR 로 캐시본을 즉시 주고 백그라운드에서 갱신한다.
    res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=86400, stale-while-revalidate=604800');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || 'fetch failed' });
  }
};
