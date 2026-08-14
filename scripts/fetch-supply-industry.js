'use strict';
// KOSPI 200개 외인/기관 + industry fetch
// scripts/update.js의 refreshInvestorFlowForAll (limit=50) 보완

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);
const naver = require('../src/data/naver');
const { all, run } = require('../src/db/connection');
const { isExcludedProduct } = require('../src/factors');

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const limit = Number(process.argv[2]) || 200;
  console.log(`[supply-industry] KOSPI 상위 ${limit}개 fetch`);

  const rows = await all(`
    SELECT s.code, s.name FROM stocks s
    WHERE s.market = 'KOSPI' AND s.name NOT LIKE '%우%'
    ORDER BY s.code LIMIT ?
  `, [limit]);
  const filtered = rows.filter((r) => !isExcludedProduct(r.name));
  console.log(`[supply-industry] 대상: ${filtered.length}개`);

  let supplyUpd = 0, industryUpd = 0, fail = 0;
  const t0 = Date.now();
  for (let i = 0; i < filtered.length; i++) {
    const r = filtered[i];
    try {
      // 1) 외인/기관 매매동향 (20일치)
      try {
        const flow = await naver.getInvestorFlow(r.code, { days: 20 });
        if (flow && flow.length > 0) {
          for (const f of flow) {
            await run(
              `INSERT INTO investor_flow (code, date, close, change, volume, institution_net, foreign_net, foreign_holding_ratio)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (code, date) DO UPDATE SET
                 close = EXCLUDED.close, change = EXCLUDED.change, volume = EXCLUDED.volume,
                 institution_net = EXCLUDED.institution_net, foreign_net = EXCLUDED.foreign_net,
                 foreign_holding_ratio = EXCLUDED.foreign_holding_ratio`,
              [r.code, f.date, f.close, f.change, f.volume, f.institution_net, f.foreign_net, f.foreign_holding_ratio]
            );
          }
          supplyUpd++;
        }
      } catch (e) { /* ignore */ }
      await sleep(50);

      // 2) industry 업데이트
      try {
        const sec = await naver.getStockSector(r.code);
        if (sec.industry) {
          await run('UPDATE stocks SET industry = ? WHERE code = ?', [sec.industry, r.code]);
          industryUpd++;
        } else if (sec.sector) {
          // industry가 없으면 sector를 industry에도 복사 (fallback)
          await run('UPDATE stocks SET industry = ? WHERE code = ?', [sec.sector, r.code]);
          industryUpd++;
        }
      } catch (e) { /* ignore */ }
      await sleep(150);
    } catch (e) {
      fail++;
    }
    if ((i + 1) % 10 === 0 || (i + 1) === filtered.length) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[supply-industry] ${i + 1}/${filtered.length} (supplyUpd=${supplyUpd} industryUpd=${industryUpd} fail=${fail} elapsed=${elapsed}s)`);
    }
  }
  console.log(`[supply-industry] 완료. supplyUpd=${supplyUpd} industryUpd=${industryUpd} fail=${fail}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
