'use strict';
// 모든 KOSPI/KOSDAQ 종목의 PER/PBR/배당수익률/섹터를 main.naver에서 빠르게 fetch
// 1회성 데이터 채우기용. 진행상황 100개마다 로그.

const db = require('../src/db/connection');
const naver = require('../src/data/naver');
const { isExcludedProduct } = require('../src/factors');

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  // 1. sector + PER/PBR 둘 다 NULL 또는 오래된 종목
  const rows = await db.all(`
    SELECT s.code, s.name, s.market,
           (SELECT MAX(updated_at) FROM fundamentals WHERE code = s.code) AS fund_updated,
           (SELECT MAX(per) FROM fundamentals WHERE code = s.code) AS per,
           (SELECT MAX(pbr) FROM fundamentals WHERE code = s.code) AS pbr,
           (SELECT MAX(dividend_yield) FROM fundamentals WHERE code = s.code) AS dvr
    FROM stocks s
    WHERE s.market IN ('KOSPI','KOSDAQ')
    ORDER BY s.market, s.code
  `);
  console.log(`[refresh-full] 대상: ${rows.length}개`);

  let sUpd = 0, fUpd = 0, sFail = 0, fFail = 0, skip = 0;
  const t0 = Date.now();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const isExcluded = isExcludedProduct(r.name);
    if (isExcluded) { skip++; continue; }

    try {
      // sector: 항상 갱신 시도 (NULL이거나 다른 값이면 다시)
      const curRows = await db.all('SELECT sector FROM stocks WHERE code = ?', [r.code]);
      const cur = curRows[0] || null;
      if (!cur || !cur.sector) {
        try {
          const sec = await naver.getStockSector(r.code);
          if (sec && sec.sector) {
            await db.run('UPDATE stocks SET sector = ? WHERE code = ?', [sec.sector, r.code]);
            sUpd++;
          } else {
            sFail++;
          }
        } catch (e) {
          sFail++;
        }
        await sleep(50);
      }

      // PER/PBR/EPS/BPS/배당: getFinance는 main.naver 한 번만 GET (sector와 공유 가능)
      // 단, 현재 sector가 이미 있으면 finance만 별도 호출
      const needFund = !r.per || !r.pbr || (r.fund_updated && new Date(r.fund_updated).toISOString() < new Date(Date.now() - 30*86400_000).toISOString());
      if (needFund) {
        try {
          const f = await naver.getFinance(r.code);
          await db.run(
            `INSERT INTO fundamentals
              (code, period, per, pbr, psr, eps, bps, roe, roa, revenue, operating_profit, net_profit, debt_ratio, dividend_yield, updated_at)
             VALUES (?, 'LATEST', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now())
             ON CONFLICT (code, period) DO UPDATE SET
               per = EXCLUDED.per, pbr = EXCLUDED.pbr, psr = EXCLUDED.psr,
               eps = EXCLUDED.eps, bps = EXCLUDED.bps, roe = EXCLUDED.roe, roa = EXCLUDED.roa,
               revenue = EXCLUDED.revenue, operating_profit = EXCLUDED.operating_profit,
               net_profit = EXCLUDED.net_profit, debt_ratio = EXCLUDED.debt_ratio,
               dividend_yield = EXCLUDED.dividend_yield, updated_at = now()`,
            [r.code, f.per, f.pbr, f.psr, f.eps, f.bps, f.roe, f.roa, f.revenue, f.operating_profit, f.net_profit, f.debt_ratio, f.dividend_yield]
          );
          fUpd++;
        } catch (e) {
          fFail++;
        }
        await sleep(50);
      }
    } catch (e) {
      console.error(`[refresh-full] ${r.code} 실패:`, e.message);
    }

    if ((i + 1) % 100 === 0 || (i + 1) === rows.length) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[refresh-full] ${i + 1}/${rows.length} (sUpd=${sUpd} fUpd=${fUpd} sFail=${sFail} fFail=${fFail} skip=${skip} elapsed=${elapsed}s)`);
    }
  }

  console.log(`[refresh-full] 완료. sector: ${sUpd}개, finance: ${fUpd}개, sector실패: ${sFail}, finance실패: ${fFail}, 제외: ${skip}`);
  await db.close();
}

main().catch((e) => {
  console.error('[refresh-full] fatal:', e);
  process.exit(1);
});
