const t = require('./public/data/top.json');
console.log('Top 종목 수:', t.length);
console.log('---');
for (const r of t) {
  console.log(`#${r.rank} ${r.grade.letter} ${r.name} (${r.code}) [${r.market}] ${r.total_score} [${r.status}]`);
}
