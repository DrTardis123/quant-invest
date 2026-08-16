// notifications.js — 인앱 알림 센터
// 알림 종류:
//   - signal_change: 매수/매도 신호 발생 (1차/2차 매수 또는 매도)
//   - data_update: 데이터 갱신 (장 마감 후)
//   - high_score: TOP 20 중 80점+ 종목 (A+ Strong Buy)
//   - low_score: 30점- 종목 (F Sell) — 회피 후보
//   - system: 시스템 메시지
//
// 알림은 page 로드 시점에 데이터(portfolio.json, top.json, distribution.json)에서 생성
// localStorage에 최근 50개 저장, 읽음/안읽음 상태 유지
(function () {
  'use strict';
  const STORAGE_KEY = 'quant_notifications';
  const READ_KEY = 'quant_notifications_read';
  const MAX_NOTIFICATIONS = 50;

  // 알림 1개 생성 헬퍼
  function make(type, priority, title, message, code = null, extra = {}) {
    return {
      id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type, priority, title, message, code,
      timestamp: new Date().toISOString(),
      ...extra
    };
  }

  // portfolio + top 데이터에서 알림 생성
  function generateFromData({ portfolio, top, distribution, movers, supplySignals, log }) {
    const notifs = [];

    // (1) 데이터 갱신 알림
    if (log && log.length > 0) {
      const last = log[0];
      const timeAgo = minutesAgo(last.run_at);
      if (last.status === 'ok') {
        notifs.push(make('data_update', 'normal',
          '✅ 데이터 갱신 완료',
          `${timeAgo}분 전 · ${last.message || '정상'} (${(last.duration_ms / 1000).toFixed(1)}초)`,
          null, { duration_ms: last.duration_ms }));
      } else if (last.status === 'error') {
        notifs.push(make('data_update', 'high',
          '⚠️ 마지막 갱신 실패',
          last.message || '오류 발생 — 자동 재시도 대기 중',
          null, { isError: true }));
      }
    }

    // (2) 10종목 포트폴리오 매수/매도 신호
    if (portfolio && portfolio.items) {
      portfolio.items.slice(0, 10).forEach((it) => {
        const totalScore = it.total_score || 0;
        // A+ Strong Buy: 80+
        if (totalScore >= 80) {
          notifs.push(make('high_score', 'high',
            `🌟 A+ 종목: ${it.name}`,
            `${it.code} · ${totalScore.toFixed(1)}점 · 섹터: ${it.sector || '—'}`,
            it.code, { grade: it.grade?.letter }));
        }
        // 1차 매수 신호: 70+ 점수
        else if (totalScore >= 70) {
          notifs.push(make('signal_change', 'normal',
            `🟢 매수 후보: ${it.name}`,
            `${it.code} · ${totalScore.toFixed(1)}점 (Buy)`,
            it.code, { grade: it.grade?.letter }));
        }
      });
    }

    // (3) 급등/급락 (±5% 이상)
    if (movers) {
      if (movers.gainers) {
        movers.gainers.slice(0, 3).forEach((m) => {
          notifs.push(make('signal_change', 'high',
            `🚀 급등: ${m.name} +${(m.change_pct || 0).toFixed(2)}%`,
            `${m.code} · ${m.market || ''} · 현재가 ${(m.close || 0).toLocaleString()}원`,
            m.code));
        });
      }
      if (movers.losers) {
        movers.losers.slice(0, 3).forEach((m) => {
          notifs.push(make('signal_change', 'high',
            `📉 급락: ${m.name} ${(m.change_pct || 0).toFixed(2)}%`,
            `${m.code} · ${m.market || ''} · 현재가 ${(m.close || 0).toLocaleString()}원`,
            m.code));
        });
      }
    }

    // (4) 수급 이상 신호
    if (supplySignals) {
      if (supplySignals.buy) {
        supplySignals.buy.slice(0, 2).forEach((s) => {
          notifs.push(make('signal_change', 'normal',
            `💰 외인+기관 매수: ${s.name}`,
            `${s.code} · 5일 누적 ${(s.foreign_5d || 0).toLocaleString()}주`,
            s.code));
        });
      }
    }

    // (5) 분포 요약 (평균 점수)
    if (distribution && distribution.summary) {
      const s = distribution.summary;
      notifs.push(make('system', 'low',
        '📊 시장 분포 요약',
        `${s.count}개 종목 · 평균 ${s.mean.toFixed(1)}점 · 표준편차 ${s.std.toFixed(1)}`,
        null, { summary: s }));
    }

    return notifs;
  }

  function minutesAgo(iso) {
    if (!iso) return 0;
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return 0;
    return Math.max(0, Math.round((Date.now() - t) / 60000));
  }

  // localStorage 안전 헬퍼
  function load(readOnly = false) {
    try {
      const list = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      const read = new Set(JSON.parse(localStorage.getItem(READ_KEY) || '[]'));
      return list.map((n) => ({ ...n, read: read.has(n.id) }));
    } catch (e) { return []; }
  }
  function save(list) {
    try {
      const trimmed = list.slice(0, MAX_NOTIFICATIONS);
      const ids = trimmed.map((n) => n.id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      localStorage.setItem(READ_KEY, JSON.stringify(ids.filter((id) => {
        // save로 호출된 list에는 read 상태 포함
        const item = trimmed.find((n) => n.id === id);
        return item && item.read;
      })));
    } catch (e) { /* quota exceeded 등 무시 */ }
  }
  function mergeAndSave(newOnes) {
    const existing = load();
    // 새 알림이 위에, 기존 알림이 아래 (중복 ID는 새 것으로 갱신)
    const map = new Map(existing.map((n) => [n.id, n]));
    newOnes.forEach((n) => map.set(n.id, { ...n, read: map.get(n.id)?.read || false }));
    const merged = Array.from(map.values()).sort((a, b) =>
      new Date(b.timestamp) - new Date(a.timestamp)
    ).slice(0, MAX_NOTIFICATIONS);
    save(merged);
    return merged;
  }
  function markAllRead() {
    try {
      const list = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      const read = list.map((n) => n.id);
      localStorage.setItem(READ_KEY, JSON.stringify(read));
    } catch (e) { /* ignore */ }
  }
  function clear() {
    try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(READ_KEY); } catch (e) {}
  }

  // 글로벌 export
  window.NotifStore = {
    generateFromData, load, save, mergeAndSave, markAllRead, clear,
    MAX_NOTIFICATIONS
  };
  console.log('[notifications] loaded');
})();
