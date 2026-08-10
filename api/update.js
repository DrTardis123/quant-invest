// Vercel Function: POST /api/update
// GitHub Actions workflow_dispatch 를 트리거해서 수동 갱신.
// GitHub PAT 가 Vercel 환경변수 GITHUB_PAT 에 설정되어 있어야 동작.

const { readFileSync, existsSync } = require('fs');
const path = require('path');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'POST only' });
    return;
  }

  res.setHeader('Content-Type', 'application/json');

  const token = process.env.GITHUB_PAT;
  const repo = process.env.GITHUB_REPO;  // 예: "Drtardis/quant-invest"

  if (!token || !repo) {
    res.status(503).json({
      ok: false,
      error: 'GITHUB_PAT / GITHUB_REPO 환경변수가 설정되지 않았습니다.',
      fallback: 'https://github.com/' + (repo || 'YOUR_USER/YOUR_REPO') + '/actions/workflows/daily.yml 에서 Run workflow 버튼을 눌러주세요.',
    });
    return;
  }

  try {
    const url = `https://api.github.com/repos/${repo}/actions/workflows/daily.yml/dispatches`;
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'quant-invest-dashboard',
      },
      body: JSON.stringify({ ref: 'main' }),
    });

    if (r.status === 204) {
      res.status(202).json({ ok: true, message: 'GitHub Actions 트리거됨. 1~2분 후 데이터 갱신 예정.' });
    } else {
      const body = await r.text();
      res.status(500).json({ ok: false, error: `GitHub API ${r.status}: ${body}` });
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
