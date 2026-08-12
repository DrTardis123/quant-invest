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

    // 강한 CDN 캐시 (정적 asset과 동일하게)
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=60');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || 'fetch failed' });
  }
};
