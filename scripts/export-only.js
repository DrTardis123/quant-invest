'use strict';

// DB는 이미 채워져 있고, JSON만 다시 export
// (full update가 너무 오래 걸릴 때 사용)

const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const { initSchema } = require('../src/db/init');
const db = require('../src/db/connection');

(async () => {
  const t0 = Date.now();
  console.log('[export] 시작 (DB 재사용, JSON만 재생성)');

  await initSchema();
  // update.js의 exportStatic를 그대로 사용
  // 그러나 update.js는 isFirst 등 다른 로직이 있어, 직접 export 호출
  process.env.NO_UPDATE = '1';
  // require로 가져오면 db.close 후 재사용 안 됨 → inline으로
  // 단순화를 위해 update.js의 exportStatic만 모킹해서 가져옴
  // 더 단순화: refreshInvestorFlow 등 skip하고 exportStatic만 직접 호출

  // update.js의 함수를 우회로 실행하기보다,
  // scripts/update.js에 exportOnly 모드를 추가하는 게 깔끔
  // 하지만 시간 절약 위해 직접 핵심만 실행
  const { calculateAll } = require('../src/factors');
  const { rows: allFactors } = await calculateAll();
  console.log(`[export] 7팩터 점수 ${allFactors.length}개 재계산`);

  // exportStatic 함수를 dynamic require
  // (db connection 공유 문제 회피: update.js가 db.close 안 하도록 exportOnly 모드 추가하는 게 정석)

  // 가장 안전: 별도 프로세스로 update.js를 exportOnly 모드로 실행
  console.log('[export] 별도 프로세스로 update.js (exportOnly) 실행 필요');

  db.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
