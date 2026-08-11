'use strict';

// 퀀트 투자 대시보드
// - 호스팅(Vercel): /api/* → /data/*.json 리라이트 (정적 데이터)
// - 로컬: /api/* → Express + DuckDB
// 양쪽 모두 apiGet() 으로 정규화.

function app() {
  return {
    // ----- 상태 -----
    tab: 'top',
    hosted: false,
    state: {
      dataSource: '',
      kisEnabled: false,
      lastPriceDate: '',
      lastScoreDate: '',
      lastUpdate: '',
      stockCount: 0,
      topN: 20,
      updating: false,
    },
    strategyKey: 'balanced',
    strategies: [],
    currentWeights: { value: 35, momentum: 20, quality: 20, volatility: 15, growth: 10 },

    indices: [],
    all: [],
    top: [],
    logs: [],
    meta: { markets: [], sectors: [] },
    filter: { q: '', market: '', sector: '', grade: '' },
    stockDetail: null,
    detailTab: 'overview',
    heatmap: [],
    heatmapLimit: 80,
    sectorData: { markets: [], sectors: [] },
    correlation: { keys: [], matrix: {} },

    // 옵티마이저 + 백테스트
    optimizer: { ok: false, error: '로딩 중...' },
    backtest: { ok: false, error: '로딩 중...' },

    _charts: {},
    _modal: null,
    _refreshTimer: null,

    // ----- 초기화 -----
    async init() {
      this._modal = new bootstrap.Modal(document.getElementById('stockModal'));

      // 모달 닫힐 때 모든 chart destroy (메모리 leak 방지)
      document.getElementById('stockModal').addEventListener('hidden.bs.modal', () => {
        this._destroyModalCharts();
        this.stockDetail = null;  // 큰 데이터 해제
      });

      this.strategies = Object.values(window.QUANT_STRATEGIES || {});
      this.currentWeights = window.QUANT_STRATEGIES[this.strategyKey].weights;

      // 새 탭으로 전환되면 해당 차트 다시 그리기
      this.$watch('detailTab', (t) => {
        if (!t) return;
        this.$nextTick(() => {
          if (t === 'supply') { this._drawSupplyChart(); this._drawHoldingChart(); }
          else if (t === 'technical') {
            this._drawMAChart(); this._drawRSIChart(); this._drawMACDChart(); this._drawBBChart();
          } else if (t === 'regression') {
            this._drawWeightChart(); this._drawContributionChart(); this._drawFactorImportanceChart();
          }
        });
      });

      await Promise.all([
        this.loadHealth(),
        this.loadMeta(),
        this.loadIndices(),
        this.loadAll(),
        this.loadLogs(),
        this.loadOptimizer(),
        this.loadBacktest(),
      ]);
      this._recomputeAndSet();
      this.$nextTick(() => this._drawAllSparklines());
      // 자동 새로고침 OFF (수동 새로고침 버튼으로만) — CPU/메모리 보호
      // this._refreshTimer = setInterval(() => this._silentRefresh(), 300_000);
    },

    _destroyModalCharts() {
      // 모달 안의 모든 chart 인스턴스 destroy (Chart.js 메모리 leak 방지)
      const keys = ['price', 'vol', 'radar', 'supply', 'holding', 'ma', 'rsi', 'macd', 'bb', 'weight', 'contrib', 'imp'];
      for (const k of keys) {
        if (this._charts[k]) { try { this._charts[k].destroy(); } catch (_) {} this._charts[k] = null; }
      }
    },

    async manualRefresh() {
      // 수동 새로고침 — 사용자가 버튼 눌렀을 때만 호출
      const btn = document.querySelector('[data-action="refresh"]');
      if (btn) { btn.disabled = true; btn.textContent = '갱신 중...'; }
      try { await this._silentRefresh(); }
      finally {
        if (btn) { btn.disabled = false; btn.textContent = '🔄 새로고침'; }
      }
    },

    setTab(t) {
      this.tab = t;
      this.$nextTick(() => {
        if (t === 'heatmap') this.loadHeatmap();
        else if (t === 'sector') this.loadSectors();
        else if (t === 'chart') this.drawCharts();
        else if (t === 'corr') this.loadCorrelation();
        else if (t === 'optimizer') this.loadOptimizer();
        else if (t === 'backtest') this.loadBacktest();
        else if (t === 'top') this._drawTopCharts();
      });
    },

    onStrategyChange() {
      const s = this.strategies.find((x) => x.key === this.strategyKey);
      if (s) this.currentWeights = s.weights;
      this._recomputeAndSet();
    },

    currentStrategy() {
      return this.strategies.find((s) => s.key === this.strategyKey);
    },

    async _silentRefresh() {
      try {
        await Promise.all([
          this.loadHealth(), this.loadMeta(), this.loadIndices(),
          this.loadAll(), this.loadLogs(),
        ]);
        this._recomputeAndSet();
        this.$nextTick(() => this._drawAllSparklines());
      } catch (e) { /* ignore */ }
    },

    _recomputeAndSet() {
      if (!this.all || this.all.length === 0) return;
      const reranked = window.recomputeWithWeights(this.all, this.currentWeights);
      this.top = reranked.slice(0, this.state.topN).map((r) => ({
        ...r,
        total_score: r.recomputed_total,
        rank: r.recomputed_rank,
        grade: window.QUANT_GRADE(r.recomputed_total),
      }));
      this.all = reranked.map((r) => ({
        ...r,
        total_score: r.recomputed_total,
        rank: r.recomputed_rank,
        grade: window.QUANT_GRADE(r.recomputed_total),
      }));
      this.$nextTick(() => this._drawTopCharts());
    },

    // ----- API 로드 -----
    async loadHealth() {
      try {
        const r = await window.apiGet('/api/health');
        if (r && r.__error) return;
        this.state.lastPriceDate = r.lastPriceDate || '—';
        this.state.lastScoreDate = r.lastScoreDate || '—';
        this.state.stockCount = r.stockCount || 0;
        this.state.lastUpdate = r.lastUpdate ? '최근 갱신: ' + r.lastUpdate : '';
        this.hosted = !!r.hosted;
      } catch (e) { /* ignore */ }
    },

    async loadMeta() {
      try {
        const r = await window.apiGet('/api/meta');
        if (!r || r.__error) return;
        this.meta = { markets: r.markets || [], sectors: r.sectors || [] };
      } catch (e) { /* ignore */ }
    },

    async loadIndices() {
      try {
        const r = await window.apiGet('/api/indices');
        this.indices = Array.isArray(r) ? r : (r.rows || []);
        this.$nextTick(() => this._drawAllSparklines());
      } catch (e) { this.indices = []; }
    },

    async loadAll() {
      try {
        const r = await window.apiGet('/api/scores?limit=2500');
        if (r && r.__error) return;
        const rows = Array.isArray(r) ? r : (r.rows || []);
        this.all = rows.map((row) => ({
          ...row,
          grade: row.grade || window.QUANT_GRADE(row.total_score),
        }));
      } catch (e) { this.all = []; }
    },

    async loadLogs() {
      try {
        const r = await window.apiGet('/api/log');
        if (r && r.__error) return;
        this.logs = Array.isArray(r) ? r : (r.rows || []);
      } catch (e) { this.logs = []; }
    },

    async loadHeatmap() {
      try {
        const r = await window.apiGet('/api/heatmap?limit=' + this.heatmapLimit);
        if (r && r.__error) return;
        const rows = Array.isArray(r) ? r : (r.rows || []);
        if (rows.length === 0) return;
        const max = Math.max(...rows.map((x) => Math.sqrt(x.market_cap || 1)));
        const min = Math.min(...rows.map((x) => Math.sqrt(x.market_cap || 1)));
        this.heatmap = rows.map((c) => {
          const w = Math.sqrt(c.market_cap || 1);
          const norm = (w - min) / (max - min + 1e-9);
          return { ...c, weight: 0.4 + norm * 2.0, color: this.scoreColor(c.total_score) };
        });
      } catch (e) { this.heatmap = []; }
    },

    async loadSectors() {
      try {
        const r = await window.apiGet('/api/sectors');
        if (r && r.__error) return;
        this.sectorData = { markets: r.markets || [], sectors: r.sectors || [] };
      } catch (e) { /* ignore */ }
    },

    async loadCorrelation() {
      try {
        const r = await window.apiGet('/api/correlation');
        if (r && r.__error) return;
        this.correlation = { keys: r.keys || [], matrix: r.matrix || {} };
      } catch (e) { /* ignore */ }
    },

    async loadOptimizer() {
      try {
        const r = await window.apiGet('/api/optimizer');
        this.optimizer = r || { ok: false, error: '응답 없음' };
      } catch (e) {
        this.optimizer = { ok: false, error: e.message };
      }
    },

    async loadBacktest() {
      try {
        const r = await window.apiGet('/api/backtest');
        this.backtest = r || { ok: false, error: '응답 없음' };
        if (r && r.ok) this.$nextTick(() => this._drawBacktestCharts());
      } catch (e) {
        this.backtest = { ok: false, error: e.message };
      }
    },

    applyOptimizerWeights() {
      if (!this.optimizer.best) return;
      this.applyWeightsFromOptimizer(this.optimizer.best.weights);
    },

    applyWeightsFromOptimizer(w) {
      if (!w) return;
      this.currentWeights = {
        value: Math.round(w.value || 0),
        momentum: Math.round(w.momentum || 0),
        quality: Math.round(w.quality || 0),
        volatility: Math.round(w.volatility || 0),
        growth: Math.round(w.growth || 0),
      };
      this.strategyKey = 'custom';
      this._recomputeAndSet();
      this.tab = 'top';
    },

    // ----- 스파크라인 -----
    _drawAllSparklines() {
      if (!Array.isArray(this.indices)) return;
      for (const idx of this.indices) {
        const ctx = document.getElementById('idx-' + idx.market);
        if (!ctx || !idx.history || idx.history.length < 2) continue;
        this._drawSparkline(ctx, idx.history, idx.changePct >= 0);
      }
    },

    _drawSparkline(canvas, points, up) {
      const ctx2d = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx2d.scale(dpr, dpr);
      ctx2d.clearRect(0, 0, w, h);
      const values = points.map((p) => p.close).filter((v) => v != null);
      if (values.length < 2) return;
      const min = Math.min(...values), max = Math.max(...values);
      const range = max - min || 1;
      const stepX = w / (values.length - 1);
      const color = up ? '#dc3545' : '#0d6efd';
      ctx2d.beginPath();
      ctx2d.strokeStyle = color;
      ctx2d.lineWidth = 1.5;
      values.forEach((v, i) => {
        const x = i * stepX;
        const y = h - ((v - min) / range) * (h - 4) - 2;
        if (i === 0) ctx2d.moveTo(x, y);
        else ctx2d.lineTo(x, y);
      });
      ctx2d.stroke();
    },

    // ----- 유틸 -----
    fmt(v) { if (v === null || v === undefined) return '—'; if (typeof v === 'number') return v.toFixed(2); return v; },
    formatPct(v) { if (v === null || v === undefined || !Number.isFinite(v)) return '—'; const sign = v >= 0 ? '+' : ''; return sign + (v * 100).toFixed(2) + '%'; },
    formatIdx(v) { if (v === null || v === undefined) return '—'; return Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
    formatCap(v) { if (!v) return '—'; const eok = v / 1e8; if (eok >= 10000) return (eok / 10000).toFixed(1) + '조'; return eok.toFixed(0) + '억'; },
    weightLabel(k) { return ({ value: '가치', momentum: '모멘텀', quality: '퀄리티', volatility: '저변동', growth: '성장' })[k] || k; },
    factorLabel(k) { return ({ value_score: '가치', momentum_score: '모멘텀', quality_score: '퀄리티', volatility_score: '저변동', growth_score: '성장', total_score: '총점', value: '가치', momentum: '모멘텀', quality: '퀄리티', volatility: '저변동', growth: '성장' })[k] || k; },
    scoreClass(v) { if (v === null || v === undefined) return ''; if (v >= 60) return 'text-success'; if (v <= 30) return 'text-danger'; return 'text-warning'; },
    scoreColor(v) { if (v === null || v === undefined || !Number.isFinite(v)) return '#adb5bd'; if (v >= 80) return '#198754'; if (v >= 70) return '#20c997'; if (v >= 60) return '#0dcaf0'; if (v >= 50) return '#0d6efd'; if (v >= 40) return '#fd7e14'; if (v >= 30) return '#dc3545'; return '#842029'; },
    corrColor(v) { const x = Math.max(-1, Math.min(1, v)); if (x >= 0) { const r = 255, g = Math.round(255 - x * 200), b = Math.round(255 - x * 220); return `rgb(${r},${g},${b})`; } else { const r = Math.round(255 + x * 200), g = Math.round(255 + x * 200), b = 255; return `rgb(${r},${g},${b})`; } },

    get filteredAll() {
      const q = this.filter.q.toLowerCase().trim();
      return this.all.filter((r) => {
        if (this.filter.market && r.market !== this.filter.market) return false;
        if (this.filter.sector && r.sector !== this.filter.sector) return false;
        if (this.filter.grade && r.grade?.letter !== this.filter.grade) return false;
        if (q && !(r.name.toLowerCase().includes(q) || r.code.includes(q))) return false;
        return true;
      });
    },

    // ----- TOP 차트 -----
    _drawTopCharts() { this._drawGradeChart(); this._drawFactorAvg(); },
    _drawGradeChart() {
      const ctx = document.getElementById('gradeChart');
      if (!ctx) return;
      const counts = {};
      for (const r of this.top) { const g = r.grade?.letter || '?'; counts[g] = (counts[g] || 0) + 1; }
      const order = ['A+', 'A', 'B+', 'B', 'C', 'D', 'F'];
      const data = order.map((g) => counts[g] || 0);
      const colors = { 'A+': '#198754', 'A': '#198754', 'B+': '#0d6efd', 'B': '#6c757d', 'C': '#fd7e14', 'D': '#dc3545', 'F': '#842029' };
      if (this._charts.grade) this._charts.grade.destroy();
      this._charts.grade = new Chart(ctx, { type: 'bar', data: { labels: order, datasets: [{ data, backgroundColor: order.map((g) => colors[g]) }] }, options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { stepSize: 1 } } } } });
    },
    _drawFactorAvg() {
      const ctx = document.getElementById('factorAvgChart');
      if (!ctx || !this.top.length) return;
      const avg = (k) => this.top.reduce((a, b) => a + (b[k] || 0), 0) / this.top.length;
      if (this._charts.factorAvg) this._charts.factorAvg.destroy();
      this._charts.factorAvg = new Chart(ctx, { type: 'bar', data: { labels: ['가치', '모멘텀', '퀄리티', '저변동', '성장'], datasets: [{ data: [avg('value_score'), avg('momentum_score'), avg('quality_score'), avg('volatility_score'), avg('growth_score')], backgroundColor: ['#0d6efd', '#198754', '#fd7e14', '#6f42c1', '#dc3545'] }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { min: 0, max: 100 } } } });
    },

    // ----- 분포 -----
    async drawCharts() {
      await this.loadAll();
      this._recomputeAndSet();
      try {
        const r = await window.apiGet('/api/distribution');
        if (r && !r.__error) this._drawDist(r.scores || []);
        this._drawFactorStack();
      } catch (e) { /* ignore */ }
    },
    _drawDist(scores) {
      const ctx = document.getElementById('distChart');
      if (!ctx) return;
      const bins = new Array(10).fill(0);
      for (const s of scores) { const i = Math.min(9, Math.max(0, Math.floor(s / 10))); bins[i]++; }
      const labels = bins.map((_, i) => `${i*10}-${i*10+10}`);
      const colors = bins.map((_, i) => this.scoreColor(i * 10 + 5));
      if (this._charts.dist) this._charts.dist.destroy();
      this._charts.dist = new Chart(ctx, { type: 'bar', data: { labels, datasets: [{ label: '종목 수', data: bins, backgroundColor: colors }] }, options: { plugins: { legend: { display: false } } } });
    },
    _drawFactorStack() {
      const ctx = document.getElementById('factorChart');
      if (!ctx) return;
      const labels = this.top.map((r) => r.name.length > 6 ? r.name.slice(0, 6) + '…' : r.name);
      const datasets = [
        { label: '가치', data: this.top.map((r) => r.value_score), backgroundColor: '#0d6efd' },
        { label: '모멘텀', data: this.top.map((r) => r.momentum_score), backgroundColor: '#198754' },
        { label: '퀄리티', data: this.top.map((r) => r.quality_score), backgroundColor: '#fd7e14' },
        { label: '저변동', data: this.top.map((r) => r.volatility_score), backgroundColor: '#6f42c1' },
        { label: '성장', data: this.top.map((r) => r.growth_score), backgroundColor: '#dc3545' },
      ];
      if (this._charts.factor) this._charts.factor.destroy();
      this._charts.factor = new Chart(ctx, { type: 'bar', data: { labels, datasets }, options: { indexAxis: 'y', plugins: { legend: { position: 'bottom' } }, scales: { x: { max: 100, stacked: true }, y: { stacked: true } } } });
    },

    // ----- 백테스트 4개 차트 -----
    _drawBacktestCharts() {
      this._drawNavChart();
      this._drawYearlyChart();
      this._drawMonthHeatmap();
      this._drawDrawdownChart();
    },
    _drawNavChart() {
      const ctx = document.getElementById('navChart');
      if (!ctx || !this.backtest.nav) return;
      if (this._charts.nav) this._charts.nav.destroy();
      const labels = this.backtest.nav.map((n) => n.idx);
      this._charts.nav = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: '전략', data: this.backtest.nav.map((n) => n.value), borderColor: '#dc3545', tension: 0.1, pointRadius: 0, fill: false },
            { label: 'KOSPI', data: this.backtest.kospiNav?.map((n) => n.value) || [], borderColor: '#6c757d', tension: 0.1, pointRadius: 0, fill: false, borderDash: [5, 5] },
          ],
        },
        options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: false, ticks: { callback: (v) => v.toFixed(2) } } } },
      });
    },
    _drawYearlyChart() {
      const ctx = document.getElementById('yearlyChart');
      if (!ctx || !this.backtest.yearlyReturns) return;
      if (this._charts.yearly) this._charts.yearly.destroy();
      const labels = this.backtest.yearlyReturns.map((y) => y.year);
      this._charts.yearly = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: '전략', data: this.backtest.yearlyReturns.map((y) => (y.strategy * 100).toFixed(2)), backgroundColor: this.backtest.yearlyReturns.map((y) => y.strategy >= 0 ? '#dc3545' : '#0d6efd') },
            { label: 'KOSPI', data: this.backtest.yearlyReturns.map((y) => (y.kospi * 100).toFixed(2)), backgroundColor: this.backtest.yearlyReturns.map((y) => y.kospi >= 0 ? '#fd7e14' : '#6c757d') },
          ],
        },
        options: {
          plugins: { legend: { position: 'bottom' } },
          scales: {
            y: { ticks: { callback: (v) => v + '%' } },
          },
        },
      });
    },
    _drawMonthHeatmap() {
      const el = document.getElementById('monthHeatmap');
      if (!el || !this.backtest.monthGrid) return;
      const grid = this.backtest.monthGrid;
      const years = Object.keys(grid).sort();
      if (years.length === 0) { el.innerHTML = '<p class="text-muted">데이터 없음</p>'; return; }

      let html = '<table class="month-heatmap-table"><thead><tr><th>년</th>';
      for (let m = 1; m <= 12; m++) html += `<th>${m}월</th>`;
      html += '<th>연간</th></tr></thead><tbody>';

      for (const year of years) {
        html += `<tr><th>${year}</th>`;
        let yearSum = 0, yearCount = 0;
        for (let m = 0; m < 12; m++) {
          const v = grid[year][m];
          if (v === null || v === undefined) {
            html += '<td class="mcell empty">-</td>';
          } else {
            const pct = (v * 100).toFixed(1);
            const color = this.scoreColor(50 + v * 100); // scale: v=-0.2 → 30, v=0 → 50, v=0.5 → 100
            html += `<td class="mcell" style="background:${color};color:#fff" title="${(v*100).toFixed(2)}%">${pct > 0 ? '+' : ''}${pct}</td>`;
            yearSum += v;
            yearCount++;
          }
        }
        const yearAvg = yearCount > 0 ? (yearSum / yearCount * 100) : 0;
        html += `<td class="mcell year-total" :class="">${yearAvg > 0 ? '+' : ''}${yearAvg.toFixed(1)}%</td>`;
        html += '</tr>';
      }
      html += '</tbody></table>';
      el.innerHTML = html;
    },
    _drawDrawdownChart() {
      const ctx = document.getElementById('drawdownChart');
      if (!ctx || !this.backtest.drawdown) return;
      if (this._charts.dd) this._charts.dd.destroy();
      this._charts.dd = new Chart(ctx, {
        type: 'line',
        data: {
          labels: this.backtest.drawdown.map((d) => d.idx),
          datasets: [{
            label: '드로우다운',
            data: this.backtest.drawdown.map((d) => d.value * 100),
            borderColor: '#0d6efd',
            backgroundColor: 'rgba(13,110,253,0.1)',
            tension: 0.1,
            pointRadius: 0,
            fill: true,
          }],
        },
        options: {
          plugins: { legend: { display: false } },
          scales: {
            y: { ticks: { callback: (v) => v.toFixed(0) + '%' }, max: 0 },
            x: { display: false },
          },
        },
      });
    },

    // ----- 종목 상세 -----
    async openStock(code) {
      try {
        const r = await window.apiGet('/api/stock/' + encodeURIComponent(code));
        if (!r || r.__error || !r.stock) return;
        this.stockDetail = r;
        this.detailTab = 'overview';
        this._modal.show();
        this.$nextTick(() => this._drawStockCharts());
      } catch (e) { console.error(e); }
    },

    get momentumReturns() {
      const p = this.stockDetail?.prices || [];
      if (p.length < 2) return { ret1: null, ret3: null, ret6: null, ret12: null };
      const sorted = [...p].sort((a, b) => new Date(a.date) - new Date(b.date));
      const last = sorted[sorted.length - 1].close;
      const at = (n) => sorted[Math.max(0, sorted.length - 1 - n)]?.close;
      return {
        ret1: at(20) ? (last - at(20)) / at(20) : null,
        ret3: at(60) ? (last - at(60)) / at(60) : null,
        ret6: at(120) ? (last - at(120)) / at(120) : null,
        ret12: at(240) ? (last - at(240)) / at(240) : null,
      };
    },

    get growthRows() {
      const f = this.stockDetail?.fundamentals || [];
      const rows = [];
      for (let i = 0; i < f.length - 1; i++) {
        const cur = f[i], prev = f[i + 1];
        rows.push({
          period: cur.period,
          revenue_yoy: (cur.revenue && prev.revenue) ? (cur.revenue - prev.revenue) / prev.revenue : null,
          profit_yoy: (cur.net_profit && prev.net_profit) ? (cur.net_profit - prev.net_profit) / Math.abs(prev.net_profit) : null,
          eps_yoy: (cur.eps && prev.eps) ? (cur.eps - prev.eps) / Math.abs(prev.eps) : null,
        });
      }
      return rows;
    },

    // ===== 새 탭용 computed =====
    get supplySummary() {
      const flow = this.stockDetail?.investor_flow || [];
      if (flow.length === 0) return { foreign_5d: 0, foreign_20d: 0, inst_5d: 0, foreign_ratio: null };
      // flow는 최신 → 과거 순
      const sumN = (key, n) => flow.slice(0, n).reduce((s, r) => s + (Number(r[key]) || 0), 0);
      const last = flow[0];
      return {
        foreign_5d: sumN('foreign_net', 5),
        foreign_20d: sumN('foreign_net', 20),
        inst_5d: sumN('institution_net', 5),
        foreign_ratio: last?.foreign_holding_ratio ?? null,
      };
    },

    get techSignals() {
      const sig = this.stockDetail?.technical?.signals || {};
      return {
        ma_trend_color: (sig.ma_trend || '').includes('상승') ? 'text-danger' : (sig.ma_trend || '').includes('하락') ? 'text-primary' : 'text-muted',
        rsi_color: sig.rsi_zone === '과매수' ? 'text-danger' : sig.rsi_zone === '과매도' ? 'text-primary' : 'text-muted',
        macd_color: (sig.macd_signal || '').includes('골든') || (sig.macd_signal || '').includes('상향') ? 'text-danger' : (sig.macd_signal || '').includes('데드') || (sig.macd_signal || '').includes('하향') ? 'text-primary' : 'text-muted',
        bb_color: (sig.bb_position || '').includes('상단') ? 'text-danger' : (sig.bb_position || '').includes('하단') ? 'text-primary' : 'text-muted',
      };
    },

    get optimizerData() { return this.optimizer; },

    // ===== 차트 그리기 =====
    _drawStockCharts() {
      this._drawPriceChart();
      this._drawVolumeChart();
      this._drawRadarChart();
    },

    _drawPriceChart() {
      const ctx = document.getElementById('priceChart');
      if (!ctx || !this.stockDetail?.prices) return;
      const sorted = [...this.stockDetail.prices].sort((a, b) => new Date(a.date) - new Date(b.date));
      if (this._charts.price) this._charts.price.destroy();
      this._charts.price = new Chart(ctx, { type: 'line', data: { labels: sorted.map((p) => p.date), datasets: [{ label: '종가', data: sorted.map((p) => p.close), borderColor: '#0d6efd', tension: 0.15, pointRadius: 0 }] }, options: { plugins: { legend: { display: false } }, scales: { x: { display: false } } } });
    },

    _drawVolumeChart() {
      const ctx = document.getElementById('volumeChart');
      if (!ctx || !this.stockDetail?.prices) return;
      const sorted = [...this.stockDetail.prices].sort((a, b) => new Date(a.date) - new Date(b.date));
      if (this._charts.vol) this._charts.vol.destroy();
      this._charts.vol = new Chart(ctx, { type: 'bar', data: { labels: sorted.map((p) => p.date), datasets: [{ label: '거래량', data: sorted.map((p) => p.volume), backgroundColor: '#6c757d' }] }, options: { plugins: { legend: { display: false } }, scales: { x: { display: false } } } });
    },

    _drawRadarChart() {
      const ctx = document.getElementById('radarChart');
      if (!ctx || !this.stockDetail?.score) return;
      const s = this.stockDetail.score;
      const data = [s.value_score, s.momentum_score, s.quality_score, s.volatility_score, s.growth_score];
      if (this._charts.radar) this._charts.radar.destroy();
      this._charts.radar = new Chart(ctx, { type: 'radar', data: { labels: ['가치', '모멘텀', '퀄리티', '저변동', '성장'], datasets: [{ label: this.stockDetail.stock.name, data, backgroundColor: 'rgba(13,110,253,0.2)', borderColor: '#0d6efd', pointBackgroundColor: '#0d6efd' }] }, options: { scales: { r: { min: 0, max: 100, ticks: { stepSize: 20 } } }, plugins: { legend: { display: false } } } });
    },

    // ===== 수급 차트 =====
    _drawSupplyChart() {
      const ctx = document.getElementById('supplyChart');
      if (!ctx) return;
      const flow = [...(this.stockDetail?.investor_flow || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
      if (flow.length === 0) { this._showNoData(ctx); return; }
      if (this._charts.supply) this._charts.supply.destroy();
      this._charts.supply = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: flow.map((r) => r.date),
          datasets: [
            { label: '외국인', data: flow.map((r) => r.foreign_net), backgroundColor: flow.map((r) => (r.foreign_net || 0) >= 0 ? 'rgba(220,53,69,0.7)' : 'rgba(13,110,253,0.7)'), stack: 's' },
            { label: '기관', data: flow.map((r) => r.institution_net), backgroundColor: flow.map((r) => (r.institution_net || 0) >= 0 ? 'rgba(255,193,7,0.7)' : 'rgba(25,135,84,0.7)'), stack: 's' },
          ],
        },
        options: {
          plugins: { legend: { position: 'top' } },
          scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: (v) => (v / 1000).toFixed(0) + 'K' } } },
        },
      });
    },

    _drawHoldingChart() {
      const ctx = document.getElementById('holdingChart');
      if (!ctx) return;
      const flow = [...(this.stockDetail?.investor_flow || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
      if (flow.length === 0) { this._showNoData(ctx); return; }
      if (this._charts.holding) this._charts.holding.destroy();
      this._charts.holding = new Chart(ctx, {
        type: 'line',
        data: { labels: flow.map((r) => r.date), datasets: [{ label: '외국인 보유율(%)', data: flow.map((r) => r.foreign_holding_ratio), borderColor: '#0d6efd', backgroundColor: 'rgba(13,110,253,0.1)', fill: true, tension: 0.2, pointRadius: 2 }] },
        options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: (v) => v + '%' } } } },
      });
    },

    // ===== 기술 차트 =====
    _drawMAChart() {
      const ctx = document.getElementById('maChart');
      if (!ctx) return;
      const t = this.stockDetail?.technical;
      if (!t || !t.indicators) { this._showNoData(ctx); return; }
      const { dates, closes, series } = t.indicators;
      if (this._charts.ma) this._charts.ma.destroy();
      const datasets = [
        { label: '종가', data: closes, borderColor: '#212529', borderWidth: 1.5, pointRadius: 0, tension: 0.1 },
      ];
      const maColors = { ma5: '#dc3545', ma20: '#fd7e14', ma60: '#0d6efd', ma120: '#6f42c1' };
      for (const k of ['ma5', 'ma20', 'ma60', 'ma120']) {
        if (series[k] && series[k].some((v) => v != null)) {
          datasets.push({ label: k.toUpperCase(), data: series[k], borderColor: maColors[k], borderWidth: 1, pointRadius: 0, tension: 0.1, spanGaps: true });
        }
      }
      this._charts.ma = new Chart(ctx, { type: 'line', data: { labels: dates, datasets }, options: { plugins: { legend: { position: 'top' } }, scales: { x: { display: false } } } });
    },

    _drawRSIChart() {
      const ctx = document.getElementById('rsiChart');
      if (!ctx) return;
      const t = this.stockDetail?.technical;
      if (!t?.indicators) { this._showNoData(ctx); return; }
      const { dates, series } = t.indicators;
      if (this._charts.rsi) this._charts.rsi.destroy();
      this._charts.rsi = new Chart(ctx, {
        type: 'line',
        data: { labels: dates, datasets: [{ label: 'RSI(14)', data: series.rsi, borderColor: '#6f42c1', pointRadius: 0, tension: 0.1 }] },
        options: {
          plugins: { legend: { display: false }, annotation: false },
          scales: { x: { display: false }, y: { min: 0, max: 100 } },
        },
        plugins: [{
          id: 'rsi-lines',
          afterDraw: (chart) => {
            const { ctx, chartArea, scales } = chart;
            const y70 = scales.y.getPixelForValue(70);
            const y30 = scales.y.getPixelForValue(30);
            ctx.save();
            ctx.strokeStyle = 'rgba(220,53,69,0.5)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(chartArea.left, y70); ctx.lineTo(chartArea.right, y70); ctx.stroke();
            ctx.strokeStyle = 'rgba(13,110,253,0.5)'; ctx.beginPath(); ctx.moveTo(chartArea.left, y30); ctx.lineTo(chartArea.right, y30); ctx.stroke();
            ctx.restore();
          },
        }],
      });
    },

    _drawMACDChart() {
      const ctx = document.getElementById('macdChart');
      if (!ctx) return;
      const t = this.stockDetail?.technical;
      if (!t?.indicators) { this._showNoData(ctx); return; }
      const { dates, series } = t.indicators;
      if (this._charts.macd) this._charts.macd.destroy();
      this._charts.macd = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: dates,
          datasets: [
            { label: 'MACD', data: series.macd, borderColor: '#0d6efd', backgroundColor: 'rgba(13,110,253,0.2)', type: 'line', pointRadius: 0, tension: 0.1, yAxisID: 'y' },
            { label: 'Signal', data: series.macd_signal, borderColor: '#dc3545', backgroundColor: 'rgba(220,53,69,0.2)', type: 'line', pointRadius: 0, tension: 0.1, yAxisID: 'y' },
            { label: 'Histogram', data: series.macd_hist, backgroundColor: series.macd_hist.map((v) => v == null ? 'rgba(0,0,0,0)' : v >= 0 ? 'rgba(220,53,69,0.6)' : 'rgba(13,110,253,0.6)'), yAxisID: 'y' },
          ],
        },
        options: { plugins: { legend: { position: 'top' } }, scales: { x: { display: false }, y: { position: 'left' } } },
      });
    },

    _drawBBChart() {
      const ctx = document.getElementById('bbChart');
      if (!ctx) return;
      const t = this.stockDetail?.technical;
      if (!t?.indicators) { this._showNoData(ctx); return; }
      const { dates, closes, series } = t.indicators;
      if (this._charts.bb) this._charts.bb.destroy();
      this._charts.bb = new Chart(ctx, {
        type: 'line',
        data: {
          labels: dates,
          datasets: [
            { label: '상단', data: series.bb_upper, borderColor: 'rgba(220,53,69,0.5)', borderWidth: 1, pointRadius: 0, fill: '+1', backgroundColor: 'rgba(108,117,125,0.1)' },
            { label: '중심(SMA20)', data: series.bb_mid, borderColor: '#6c757d', borderWidth: 1, pointRadius: 0 },
            { label: '하단', data: series.bb_lower, borderColor: 'rgba(13,110,253,0.5)', borderWidth: 1, pointRadius: 0, fill: false },
            { label: '종가', data: closes, borderColor: '#212529', borderWidth: 1.5, pointRadius: 0, tension: 0.1 },
          ],
        },
        options: { plugins: { legend: { position: 'top' } }, scales: { x: { display: false } } },
      });
    },

    // ===== 회귀 차트 =====
    _drawWeightChart() {
      const ctx = document.getElementById('weightChart');
      if (!ctx) return;
      const w = this.currentWeights || { value: 0, momentum: 0, quality: 0, volatility: 0, growth: 0 };
      if (this._charts.weight) this._charts.weight.destroy();
      this._charts.weight = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: ['가치', '모멘텀', '퀄리티', '저변동', '성장'],
          datasets: [{ data: [w.value, w.momentum, w.quality, w.volatility, w.growth], backgroundColor: ['#0d6efd', '#198754', '#ffc107', '#6c757d', '#dc3545'] }],
        },
        options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, max: 50, ticks: { callback: (v) => v + '%' } } } },
      });
    },

    _drawContributionChart() {
      const ctx = document.getElementById('contributionChart');
      if (!ctx) return;
      const c = this.stockDetail?.contributions;
      if (!c) { this._showNoData(ctx); return; }
      if (this._charts.contrib) this._charts.contrib.destroy();
      this._charts.contrib = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['가치', '모멘텀', '퀄리티', '저변동', '성장'],
          datasets: [{ data: [c.value, c.momentum, c.quality, c.volatility, c.growth], backgroundColor: ['#0d6efd', '#198754', '#ffc107', '#6c757d', '#dc3545'] }],
        },
        options: { plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: (ctx) => ctx.label + ': ' + ctx.parsed + '%' } } } },
      });
    },

    _drawFactorImportanceChart() {
      const ctx = document.getElementById('factorImportanceChart');
      if (!ctx) return;
      const imp = this.optimizer?.regression?.importance;
      if (!imp) { this._showNoData(ctx, '아직 회귀분석 데이터가 충분하지 않습니다 (최소 30일 데이터 필요)'); return; }
      if (this._charts.imp) this._charts.imp.destroy();
      this._charts.imp = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: ['가치', '모멘텀', '퀄리티', '저변동', '성장'],
          datasets: [{ data: [imp.value, imp.momentum, imp.quality, imp.volatility, imp.growth], backgroundColor: ['#0d6efd', '#198754', '#ffc107', '#6c757d', '#dc3545'] }],
        },
        options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { callback: (v) => v + '%' } } } },
      });
    },

    _showNoData(ctx, msg) {
      const c = ctx.getContext ? ctx.getContext('2d') : null;
      if (!c) return;
      c.clearRect(0, 0, ctx.width, ctx.height);
      c.fillStyle = '#999';
      c.font = '14px sans-serif';
      c.textAlign = 'center';
      c.fillText(msg || '데이터 없음 (아직 충분히 쌓이지 않음)', ctx.width / 2, ctx.height / 2);
    },

    async triggerUpdate() {
      this.state.updating = true;
      try {
        const r = await fetch('/api/update', { method: 'POST' });
        const data = await r.json();
        if (r.ok && data.ok) {
          setTimeout(() => this._silentRefresh(), 90_000);
        } else {
          alert(data.fallback || data.error || '업데이트 요청 실패');
        }
        this.state.updating = false;
      } catch (e) {
        console.error(e);
        this.state.updating = false;
      }
    },
  };
}
