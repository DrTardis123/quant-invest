// common.js — 메인/분석 페이지 공통 유틸리티
// 의도: app.js에서 inline으로 정의되던 헬퍼들을 분리해 재사용·테스트 용이
//
// 사용법 (Alpine 컴포넌트 내부):
//   fmt(v)            → window.Q.fmt(v)
//   formatPct(0.123)  → window.Q.formatPct(0.123)  // "+12.30%"
//   scoreColor(80)    → window.Q.scoreColor(80)
//   factorLabel('value_score')  → '가치'
//
// ※ Alpine template (x-text, :class 등)에서는 직접 호출 가능
(function () {
  'use strict';

  // ===== 포맷 헬퍼 =====
  function fmt(v) {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'number') return v.toFixed(2);
    return v;
  }
  function fmtFund(v) {
    if (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) return '—';
    return Number(v).toFixed(2);
  }
  function formatPct(v) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    const sign = v >= 0 ? '+' : '';
    return sign + (v * 100).toFixed(2) + '%';
  }
  function formatIdx(v) {
    if (v === null || v === undefined) return '—';
    return Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function formatCap(v) {
    if (!v) return '—';
    const eok = v / 1e8;
    if (eok >= 10000) return (eok / 10000).toFixed(1) + '조';
    return eok.toFixed(0) + '억';
  }
  function formatVolume(shares) {
    if (shares === null || shares === undefined || !Number.isFinite(shares)) return '—';
    const n = Number(shares);
    if (Math.abs(n) >= 100000000) return (n / 100000000).toFixed(1) + '억주';
    if (Math.abs(n) >= 10000) return (n / 10000).toFixed(1) + '만주';
    return n.toLocaleString() + '주';
  }
  function formatWon(won) {
    if (won === null || won === undefined || !Number.isFinite(won)) return '—';
    const n = Number(won);
    if (Math.abs(n) >= 1e12) return (n / 1e12).toFixed(1) + '조';
    if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(0) + '억';
    return n.toLocaleString() + '원';
  }

  // ===== 점수/색상 =====
  function scoreColor(score) {
    if (score == null || !Number.isFinite(Number(score))) return '#6c757d';
    const s = Number(score);
    if (s >= 80) return '#198754';  // A+ 초록
    if (s >= 70) return '#20c997';  // A
    if (s >= 60) return '#0d6efd';  // B+ 파랑
    if (s >= 50) return '#6c757d';  // B 회색
    if (s >= 40) return '#fd7e14';  // C 주황
    if (s >= 30) return '#dc3545';  // D 빨강
    return '#842029';                // F 진빨강
  }
  function scoreClass(score) {
    if (score == null || !Number.isFinite(Number(score))) return '';
    const s = Number(score);
    if (s >= 80) return 'text-success fw-bold';
    if (s >= 70) return 'text-success';
    if (s >= 60) return 'text-primary fw-bold';
    if (s >= 50) return 'text-muted';
    if (s >= 40) return 'text-warning';
    if (s >= 30) return 'text-danger';
    return 'text-danger fw-bold';
  }
  // 상관계수 색상 (-1 빨강 → 0 흰색 → +1 파랑)
  function corrColor(r) {
    if (r == null || !Number.isFinite(Number(r))) return '#ffffff';
    const v = Number(r);
    if (v >= 0) {
      // 양의 상관: 0(흰) → 1(파랑)
      const intensity = Math.min(1, Math.max(0, v));
      const b = 255 - Math.round(intensity * 80);
      return `rgb(${255 - Math.round(intensity * 60)}, ${255 - Math.round(intensity * 60)}, ${b})`;
    } else {
      // 음의 상관: 0(흰) → -1(빨강)
      const intensity = Math.min(1, Math.max(0, -v));
      return `rgb(255, ${255 - Math.round(intensity * 60)}, ${255 - Math.round(intensity * 60)})`;
    }
  }

  // ===== 라벨 =====
  const FACTOR_LABELS = {
    value: '가치', momentum: '모멘텀', quality: '퀄리티', volatility: '저변동',
    growth: '성장', liquidity: '유동', supply: '수급',
    value_score: '가치', momentum_score: '모멘텀', quality_score: '퀄리티', volatility_score: '저변동',
    growth_score: '성장', liquidity_score: '유동', supply_score: '수급',
    total_score: '총점'
  };
  function factorLabel(k) { return FACTOR_LABELS[k] || k; }
  function weightLabel(k) {
    const short = { value: '가치', momentum: '모멘텀', quality: '퀄리티', volatility: '저변동', growth: '성장', liquidity: '유동', supply: '수급' };
    return short[k] || k;
  }
  function valuationLabel(k) {
    return ({ per: 'PER', pbr: 'PBR', psr: 'PSR', eps: 'EPS', bps: 'BPS', dividend_yield: '배당률(%)' })[k] || k;
  }
  function valuationClass(k, v) {
    if (v === null || v === undefined) return '';
    if (k === 'per') return v < 10 ? 'text-danger' : (v > 25 ? 'text-primary' : '');
    if (k === 'pbr') return v < 1 ? 'text-danger' : (v > 2 ? 'text-primary' : '');
    if (k === 'dividend_yield') return v >= 3 ? 'text-danger' : '';
    return '';
  }
  function qualityLabel(k) {
    return ({ roe: 'ROE(%)', roa: 'ROA(%)', debt_ratio: '부채비율(%)', operating_margin: '영업이익률(%)', net_margin: '순이익률(%)' })[k] || k;
  }
  function qualityClass(k, v) {
    if (v === null || v === undefined) return '';
    if (k === 'roe') return v >= 15 ? 'text-danger fw-bold' : (v < 5 ? 'text-primary' : '');
    if (k === 'roa') return v >= 8 ? 'text-danger fw-bold' : (v < 3 ? 'text-primary' : '');
    if (k === 'debt_ratio') return v > 200 ? 'text-primary fw-bold' : (v < 100 ? 'text-danger' : '');
    if (k === 'operating_margin') return v >= 10 ? 'text-danger fw-bold' : (v < 5 ? 'text-primary' : '');
    if (k === 'net_margin') return v >= 7 ? 'text-danger fw-bold' : (v < 3 ? 'text-primary' : '');
    return '';
  }
  function analystRatingClass(rating) {
    if (!rating) return 'bg-secondary';
    if (rating === 'Strong Buy') return 'bg-danger';
    if (rating === 'Buy') return 'bg-warning text-dark';
    if (rating === 'Accumulate') return 'bg-info';
    if (rating === 'Hold') return 'bg-secondary';
    if (rating === 'Reduce') return 'bg-warning text-dark';
    if (rating === 'Sell') return 'bg-dark';
    return 'bg-secondary';
  }

  // ===== 등급/총점 → 라벨/색상 (백분위 → 학점 변환) =====
  function gradeFor(score) {
    if (score == null || !Number.isFinite(Number(score))) return { letter: '—', label: 'N/A', color: 'secondary' };
    const s = Number(score);
    if (s >= 80) return { letter: 'A+', label: 'Strong Buy', color: 'success' };
    if (s >= 70) return { letter: 'A',  label: 'Buy',         color: 'success' };
    if (s >= 60) return { letter: 'B+', label: 'Accumulate',  color: 'primary' };
    if (s >= 50) return { letter: 'B',  label: 'Hold',        color: 'secondary' };
    if (s >= 40) return { letter: 'C',  label: 'Watch',       color: 'warning' };
    if (s >= 30) return { letter: 'D',  label: 'Avoid',       color: 'danger' };
    return { letter: 'F', label: 'Sell', color: 'dark' };
  }

  // ===== localStorage 안전 헬퍼 =====
  function lsGet(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  // ===== 글로벌 export =====
  window.Q = {
    fmt, fmtFund, formatPct, formatIdx, formatCap, formatVolume, formatWon,
    scoreColor, scoreClass, corrColor,
    factorLabel, weightLabel, valuationLabel, valuationClass, qualityLabel, qualityClass,
    analystRatingClass, gradeFor,
    lsGet, lsSet
  };
  console.log('[common] loaded (window.Q exported)');
})();
