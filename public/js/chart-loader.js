// Chart.js Lazy Loader
// 페이지 로드 시 Chart.js를 즉시 로드하지 않고, 첫 차트 호출 시 dynamic import로 로드
// 효과: 초기 HTML payload에서 Chart.js 200KB 제거 → 첫 페이지 ~3배 빠른 FCP
//
// 사용법:
//   await window.ChartLoader.load();
//   new window.Chart(ctx, {...});
//
// 이미 로드됐으면 즉시 반환 (한 번만 로드)
(function () {
  'use strict';
  let _loadPromise = null;
  let _Chart = null;
  let _loading = false;
  let _callbacks = [];

  function _flushCallbacks() {
    _callbacks.forEach((cb) => { try { cb(window.Chart); } catch (e) { console.error('[chart-loader] callback err:', e); } });
    _callbacks = [];
  }

  async function load() {
    if (_Chart) return _Chart;                    // 이미 로드됨
    if (_loadPromise) return _loadPromise;        // 로드 중 (중복 방지)
    _loadPromise = (async () => {
      console.log('[chart-loader] dynamic import Chart.js...');
      const t0 = performance.now();
      try {
        // CDN dynamic import (UMD build는 직접 import 불가, script 태그 동적 삽입)
        _Chart = await _loadScript();
        const ms = (performance.now() - t0).toFixed(0);
        console.log(`[chart-loader] Chart.js loaded in ${ms}ms`);
        _loading = false;
        _flushCallbacks();
        return _Chart;
      } catch (e) {
        console.error('[chart-loader] load failed:', e);
        _loadPromise = null;
        _loading = false;
        throw e;
      }
    })();
    return _loadPromise;
  }

  function _loadScript() {
    return new Promise((resolve, reject) => {
      // 이미 chart.js script가 있으면 그대로 사용
      if (window.Chart && window.Chart.version) {
        resolve(window.Chart);
        return;
      }
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js';
      s.async = false; // 차트 그리기 전에 로드 완료 보장
      s.onload = () => {
        if (window.Chart) resolve(window.Chart);
        else reject(new Error('Chart not exposed after load'));
      };
      s.onerror = (e) => reject(new Error('Chart.js script load failed'));
      document.head.appendChild(s);
    });
  }

  // 차트 그리기 직전에 호출: 아직 로드 안됐으면 백그라운드에서 로드 시작
  // 이미 로드 중이면 콜백으로 완료 시 알림
  function preload() {
    if (_Chart || _loadPromise) return _loadPromise;
    if (!_loading) {
      _loading = true;
      load().catch((e) => console.warn('[chart-loader] preload failed:', e));
    }
    return _loadPromise;
  }

  // 차트 그리기 함수 등록: Chart 로드 후 실행됨
  function onReady(cb) {
    if (_Chart) { cb(_Chart); return; }
    _callbacks.push(cb);
    if (!_loading) preload();
  }

  // 즉시 로드 후 콜백 실행
  async function ready(cb) {
    const C = await load();
    if (cb) cb(C);
    return C;
  }

  // 상태 조회
  function isLoaded() { return !!_Chart; }
  function isLoading() { return !!_loadPromise && !_Chart; }

  window.ChartLoader = { load, preload, onReady, ready, isLoaded, isLoading };
  console.log('[chart-loader] ready (lazy)');
})();
