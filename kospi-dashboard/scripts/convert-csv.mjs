// CSV → JSON 변환 (대시보드용 데이터)
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SRC = "C:/Users/LG/.minimax/workspace/kospi-factor";
const OUT = "C:/Users/LG/.minimax/workspace/kospi-dashboard/data";

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

// ── 1. fundamentals_snapshot.csv → JSON ──
console.log("[1/4] fundamentals ...");
const fundRaw = readFileSync(`${SRC}/fundamentals_snapshot.csv`, "utf-8");
const fundLines = fundRaw.split("\n").filter(Boolean);
const fundHeader = fundLines[0].split(",");
const fund = fundLines.slice(1).map((line) => {
  const cols = line.split(",");
  const obj = {};
  fundHeader.forEach((h, i) => {
    const v = cols[i];
    obj[h] = v === "" || v === undefined ? null : v;
  });
  // 숫자 변환
  for (const k of ["PER", "PBR", "ROE", "PSR", "DividendYield", "DebtEquity", "ForeignOwnership", "OperatingMargin"]) {
    if (obj[k] != null && obj[k] !== "NaN") {
      obj[k] = Number(obj[k]);
    } else {
      obj[k] = null;
    }
  }
  return obj;
});
writeFileSync(`${OUT}/fundamentals.json`, JSON.stringify(fund, null, 0));
console.log(`  → ${fund.length} stocks`);

// ── 2. monthly_factors.csv.gz → JSON (가벼운 형태) ──
console.log("[2/4] monthly_factors ...");
const zlib = await import("node:zlib");
const monthlyRaw = readFileSync(`${SRC}/monthly_factors.csv.gz`);
const monthlyDecompressed = zlib.gunzipSync(monthlyRaw).toString("utf-8");
const mLines = monthlyDecompressed.split("\n").filter(Boolean);
const mHeader = mLines[0].split(",");
const monthly = mLines.slice(1).map((line) => {
  const cols = line.split(",");
  const obj = {};
  mHeader.forEach((h, i) => {
    obj[h] = cols[i];
  });
  return obj;
});
writeFileSync(`${OUT}/monthly_factors.json`, JSON.stringify(monthly));
console.log(`  → ${monthly.length} rows`);

// ── 3. factor_betas.csv → JSON ──
console.log("[3/4] factor_betas ...");
const betaRaw = readFileSync(`${SRC}/factor_betas.csv`, "utf-8");
const bLines = betaRaw.split("\n").filter(Boolean);
const bHeader = bLines[0].split(",");
const betas = bLines.slice(1).map((line) => {
  const cols = line.split(",");
  const obj = {};
  bHeader.forEach((h, i) => {
    obj[h] = cols[i] === "" ? null : isNaN(Number(cols[i])) ? cols[i] : Number(cols[i]);
  });
  return obj;
});
writeFileSync(`${OUT}/factor_betas.json`, JSON.stringify(betas));
console.log(`  → ${betas.length} months`);

// ── 4. round2_summary.json → 그대로 복사 ──
console.log("[4/4] round2_summary ...");
const summary = JSON.parse(readFileSync(`${SRC}/round2_summary.json`, "utf-8"));
writeFileSync(`${OUT}/round2_summary.json`, JSON.stringify(summary, null, 2));
console.log(`  → ok`);

console.log("\n✓ 변환 완료. data/ 디렉토리:");
for (const f of readdirSync(OUT)) {
  const stat = existsSync(join(OUT, f)) ? readFileSync(join(OUT, f)).length : 0;
  console.log(`  ${f}  (${(stat / 1024).toFixed(1)} KB)`);
}
