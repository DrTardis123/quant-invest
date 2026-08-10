'use strict';

const cfg = require('./config');
const { initSchema } = require('./db/init');
const { start: startServer } = require('./server');
const { schedule: scheduleCron, runUpdate } = require('./scheduler/jobs');

(async () => {
  console.log(`[boot] 데이터 소스: ${cfg.data.source}${cfg.isKisEnabled() ? ' (KIS 모드)' : ''}`);
  await initSchema();
  console.log('[boot] 스키마 초기화 완료');

  // 시작 시 1회 즉시 갱신 (백필이 비어 있으면 풀백필, 있으면 가격만)
  // SKIP_BOOT_UPDATE=1 이면 백필 건너뛰기 (테스트용)
  if (process.env.SKIP_BOOT_UPDATE === '1') {
    console.log('[boot] SKIP_BOOT_UPDATE=1 → 초기 갱신 건너뜀');
  } else {
    try {
      const db = require('./db/connection');
      const cnt = (await db.one(`SELECT COUNT(*) AS c FROM daily_prices`))?.c || 0;
      if (cnt === 0) {
        console.log('[boot] 첫 실행 → 전체 백필 시작 (시간이 좀 걸립니다)');
        await runUpdate();
      } else {
        console.log('[boot] 일봉 데이터 있음 → 점수만 재계산');
        const { calculateAll, persistScores } = require('./factors');
        const { rows } = await calculateAll();
        await persistScores(rows);
        console.log(`[boot] 점수 ${rows.length}건 갱신 완료`);
      }
    } catch (e) {
      console.error('[boot] 초기 갱신 실패:', e.message);
    }
  }

  // 크론 등록
  scheduleCron();

  // 웹 서버 시작
  startServer();

  console.log('[boot] 준비 완료. 대시보드: http://' + cfg.host + ':' + cfg.port);
})().catch((e) => {
  console.error('[fatal]', e);
  process.exit(1);
});
