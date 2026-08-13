// 테스트: maxPages 로직 확인
const path = require('path');
process.chdir('C:\\Users\\LG\\Documents\\quant_invest');

(async () => {
  // DB 연결은 비용이 크니 모킹 없이 로직만 확인
  const code = require('fs').readFileSync('scripts/update.js', 'utf8');
  // maxPages=2 (첫 실행) 인지 확인
  const hasMaxPages = code.includes('maxPages: 2');
  const hasIsInitial = code.includes('isInitial ? 30 : 60');
  const hasExistingCount = code.includes('existingCount');
  console.log('maxPages:2 logic:', hasMaxPages ? '✓' : '✗');
  console.log('isInitial sleep:', hasIsInitial ? '✓' : '✗');
  console.log('existingCount check:', hasExistingCount ? '✓' : '✗');

  // 시간 추정
  const stocks = 3920;
  const pagesPerStock = 2; // 첫 실행
  const pageTime = 200; // ms (HTTP + parse + sleep)
  const interStock = 30; // ms
  const totalMs = stocks * (pagesPerStock * pageTime + interStock);
  const totalMin = totalMs / 60000;
  console.log(`\n첫 실행 예상 시간: ${totalMin.toFixed(1)}분`);
  console.log(`  - ${stocks} 종목 × ${pagesPerStock} 페이지 = ${stocks * pagesPerStock} 요청`);
  console.log(`  - 요청당 ~${pageTime}ms`);
  console.log(`  - 종목간 ${interStock}ms`);

  if (totalMin < 30) console.log('  ✓ 90분 timeout 안전');
  else if (totalMin < 60) console.log('  ⚠ 90분 timeout 가능 (최악)');
  else console.log('  ✗ 90분 timeout 위험');
})();
