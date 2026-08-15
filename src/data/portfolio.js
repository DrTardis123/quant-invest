'use strict';
// Portfolio 자동 선정: top 20 중 10개 섹터 분산
// 1) 섹터별 그룹화 → 각 섹터에서 1개씩 우선 배정 (섹터 다양성)
// 2) 부족하면 같은 섹터에서 점수 높은 순 추가
// 3) 총 10개 (또는 가용 종목 수)
// 4) 비중: 균등 10% (1/N)
// 5) 거래정지/거래량 0 종목 제외

const { isExcludedProduct } = require('../factors');

function buildPortfolio(top20, opts = {}) {
  const maxN = opts.maxN || 10;
  const equalWeight = opts.equalWeight !== false; // 기본 균등
  const minPerSector = opts.minPerSector || 1;
  const maxPerSector = opts.maxPerSector || 2;

  // 1) 거래정지/거래량 0/우선주/ETF 제외
  const valid = top20.filter((r) => {
    if (r.status === 'halt' || r.status === 'zero_volume') return false;
    if (r.total_score <= 0) return false;
    if (isExcludedProduct(r.name)) return false;
    return true;
  });

  // 2) 섹터별 그룹화
  const grouped = {};
  for (const s of valid) {
    const sec = s.sector || '(미분류)';
    if (!grouped[sec]) grouped[sec] = [];
    grouped[sec].push(s);
  }
  for (const sec of Object.keys(grouped)) {
    grouped[sec].sort((a, b) => (b.total_score || 0) - (a.total_score || 0));
  }

  // 3) 각 섹터에서 1개씩 우선 배정
  const sectors = Object.keys(grouped).sort((a, b) => grouped[b].length - grouped[a].length);
  const picks = [];
  const sectorUsed = {};
  for (const sec of sectors) {
    if (picks.length >= maxN) break;
    if (sectorUsed[sec] >= maxPerSector) continue;
    const top = grouped[sec][0];
    picks.push({ ...top, sectorCount: 1 });
    sectorUsed[sec] = 1;
    grouped[sec].shift();
  }

  // 4) 부족하면 같은 섹터에서 점수 높은 순 추가 (섹터당 maxPerSector까지)
  for (const sec of sectors) {
    if (picks.length >= maxN) break;
    while (sectorUsed[sec] < maxPerSector && grouped[sec].length > 0) {
      const next = grouped[sec].shift();
      picks.push({ ...next, sectorCount: (sectorUsed[sec] || 0) + 1 });
      sectorUsed[sec] = (sectorUsed[sec] || 0) + 1;
      if (picks.length >= maxN) break;
    }
  }

  // 5) 여전히 부족하면 남은 종목 중 점수 순
  if (picks.length < maxN) {
    const all = [];
    for (const sec of Object.keys(grouped)) {
      for (const s of grouped[sec]) all.push(s);
    }
    all.sort((a, b) => (b.total_score || 0) - (a.total_score || 0));
    for (const s of all) {
      if (picks.length >= maxN) break;
      if (picks.some((p) => p.code === s.code)) continue;
      picks.push({ ...s, sectorCount: (sectorUsed[s.sector] || 0) + 1 });
      sectorUsed[s.sector] = (sectorUsed[s.sector] || 0) + 1;
    }
  }

  const final = picks.slice(0, maxN);

  // 6) 비중 계산
  const w = equalWeight ? 100 / final.length : 0;
  for (const p of final) {
    p.weight = round2(w);
    p.amount = null; // 투자 금액 (사용자 입력)
  }

  // 7) 섹터 분포 통계
  const sectorDist = {};
  for (const p of final) {
    sectorDist[p.sector] = (sectorDist[p.sector] || 0) + 1;
  }

  return {
    n: final.length,
    items: final.map((p, i) => ({
      rank: i + 1,
      code: p.code,
      name: p.name,
      market: p.market,
      sector: p.sector,
      industry: p.industry,
      total_score: p.total_score,
      grade: p.grade,
      weight: p.weight,
      value_score: p.value_score,
      momentum_score: p.momentum_score,
      quality_score: p.quality_score,
      volatility_score: p.volatility_score,
      growth_score: p.growth_score,
      liquidity_score: p.liquidity_score,
      supply_score: p.supply_score,
    })),
    sectorDistribution: sectorDist,
    equalWeight,
    rebalanceNote: '월 1회 리밸런싱 권장 (5일선 데드크로스 시 즉시 재평가)',
  };
}

function round2(v) { return Math.round(v * 100) / 100; }

module.exports = { buildPortfolio };
