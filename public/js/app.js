'use strict';

// 퀀트 투자 대시보드
// - 로컬: /api/* → Express + DuckDB (서버 사이드 가중치)
// - 호스팅(Vercel): /api/* → /data/*.json 리라이트 (클라이언트 가중치)
//   - 응답은 JSON 직접 형태 (배열 or 객체). apiGet() 으로 정규화.

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

    indices: [],            // KOSPI / KOSDAQ / KOSPI200
    all: [],                // 전체 (가중치 적용 전 원본)
    top: [],                // 상위 (전략 적용 후)
    logs: [],
    meta: { markets: [], sectors: [] },
    filter: { q: '', market: '', sector: '', grade: '' },
    stockDetail: null,
    detailTab: 'overview',
    heatmap: [],
    heatmapLimit: 80,
    sectorData: { markets: [], sectors: [] },
    correlation: { keys: [], matrix: {} },
    bt: { topN: 20, months: 12, result: null },

    _charts: {},
    _modal: null,
    _refreshTimer: null,

    // ----- 초기화 -----
    async init() {
      this._modal = new bootstrap.Modal(document.getElementById('stockModal'));
      this.strategies = Object.values(window.QUANT_STRATEGIES || {});
      this.currentWeights = window.QUANT_STRATEGIES[this.strategyKey].weights;

      await Promise.all([
        this.loadHealth(),
        this.loadMeta(),
        this.loadIndices(),
        this.loadAll(),
        this.loadLogs(),
      ]);
      this._recomputeAndSet();
      this.$nextTick(() => this._drawAllSparklines());

      this._refreshTimer = setInterval(() => this._silentRefresh(), 120_000);
    },

    setTab(t) {
      this.tab = t;
      this.$nextTick(() => {
        if (t === 'heatmap') this.loadHeatmap();
        else if (t === 'sector') this.loadSectors();
        else if (t === 'chart') this.drawCharts();
        else if (t === 'corr') this.loadCorrelation();
        else if (t === 'backtest') this.runBacktest();
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
          this.loadHealth(),
          this.loadMeta(),
          this.loadIndices(),
          this.loadAll(),
          this.loadLogs(),
        ]);
        this._recomputeAndSet();
        this.$nextTick(() => this._drawAllSparklines());
      } catch (e) { /* ignore */ }
    },

    // ----- 가중치 재계산 (클라이언트) -----
    _recomputeAndSet() {
      if (!this.all || this.all.length === 0) return;
      const reranked = window.recomputeWithWeights(this.all, this.currentWeights);
      this.top = reranked.slice(0, this.state.topN).map((r) => ({
        ...r,
        total_score: r.recomputed_total,
        rank: r.recomputed_rank,
        grade: window.QUANT_GRADE(r.recomputed_total),
      }));
      // 전체도 재계산 (필터링 위해)
      this.all = reranked.map((r) => ({
        ...r,
        total_score: r.recomputed_total,
        rank: r.recomputed_rank,
        grade: window.QUANT_GRADE(r.recomputed_total),
      }));
      this.$nextTick(() => this._drawTopCharts());
    },

    // ----- API 로드 (래퍼로 정규화) -----
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
        if (r.stats) {
          this.state.stockCount = r.stats.stocks || this.state.stockCount;
          this.state.lastScoreDate = r.stats.last_score_date || this.state.lastScoreDate;
        }
      } catch (e) { /* ignore */ }
    },

    async loadIndices() {
      try {
        const r = await window.apiGet('/api/indices');
        this.indices = Array.isArray(r) ? r : (r.rows || []);
        this.$nextTick(() => this._drawAllSparklines());
      } catch (e) {
        this.indices = [];
      }
    },

    async loadAll() {
      try {
        const r = await window.apiGet('/api/scores?limit=2500');
        if (r && r.__error) return;
        const rows = Array.isArray(r) ? r : (r.rows || []);
        // 점수 보존 (재가중치 계산용)
        this.all = rows.map((row) => ({
          ...row,
          grade: row.grade || window.QUANT_GRADE(row.total_score),
        }));
      } catch (e) {
        this.all = [];
      }
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
          return {
            ...c,
            weight: 0.4 + norm * 2.0,
            color: this.scoreColor(c.total_score),
          };
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

    async runBacktest() {
      try {
        const r = await window.apiGet(`/api/backtest?topN=${this.bt.topN}&months=${this.bt.months}`);
        this.bt.result = r || {};
        if (r.ok) this.$nextTick(() => this._drawNavChart());
      } catch (e) { /* ignore */ }
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

      // 데이터 정규화
      const values = points.map((p) => p.close).filter((v) => v != null);
      if (values.length < 2) return;
      const min = Math.min(...values), max = Math.max(...values);
      const range = max - min || 1;
      const stepX = w / (values.length - 1);

      const color = up ? '#dc3545' : '#0d6efd';  // 한국식: 빨강=상승, 파랑=하락
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
    fmt(v) {
      if (v === null || v === undefined) return '—';
      if (typeof v === 'number') return v.toFixed(2);
      return v;
    },
    formatPct(v) {
      if (v === null || v === undefined || !Number.isFinite(v)) return '—';
      const sign = v >= 0 ? '+' : '';
      return sign + (v * 100).toFixed(2) + '%';
    },
    formatIdx(v) {
      if (v === null || v === undefined) return '—';
      return Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },
    formatCap(v) {
      if (!v) return '—';
      const eok = v / 1e8;
      if (eok >= 10000) return (eok / 10000).toFixed(1) + '조';
      return eok.toFixed(0) + '억';
    },
    weightLabel(k) {
      return ({ value: '가치', momentum: '모멘텀', quality: '퀄리티', volatility: '저변동', growth: '성장' })[k] || k;
    },
    factorLabel(k) {
      return ({
        value_score: '가치', momentum_score: '모멘텀', quality_score: '퀄리티',
        volatility_score: '저변동', growth_score: '성장', total_score: '총점',
        value: '가치', momentum: '모멘텀', quality: '퀄리티', volatility: '저변동', growth: '성장',
      })[k] || k;
    },
    scoreClass(v) {
      if (v === null || v === undefined) return '';
      if (v >= 60) return 'text-success';
      if (v <= 30) return 'text-danger';
      return 'text-warning';
    },
    scoreColor(v) {
      if (v === null || v === undefined || !Number.isFinite(v)) return '#adb5bd';
      if (v >= 80) return '#198754';
      if (v >= 70) return '#20c997';
      if (v >= 60) return '#0dcaf0';
      if (v >= 50) return '#0d6efd';
      if (v >= 40) return '#fd7e14';
      if (v >= 30) return '#dc3545';
      return '#842029';
    },
    corrColor(v) {
      const x = Math.max(-1, Math.min(1, v));
      if (x >= 0) {
        const r = 255, g = Math.round(255 - x * 200), b = Math.round(255 - x * 220);
        return `rgb(${r},${g},${b})`;
      } else {
        const r = Math.round(255 + x * 200), g = Math.round(255 + x * 200), b = 255;
        return `rgb(${r},${g},${b})`;
      }
    },

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

    // ----- 차트 -----
    _drawTopCharts() {
      this._drawGradeChart();
      this._drawFactorAvg();
    },
    _drawGradeChart() {
      const ctx = document.getElementById('gradeChart');
      if (!ctx) return;
      const counts = {};
      for (const r of this.top) {
        const g = r.grade?.letter || '?';
        counts[g] = (counts[g] || 0) + 1;
      }
      const order = ['A+', 'A', 'B+', 'B', 'C', 'D', 'F'];
      const data = order.map((g) => counts[g] || 0);
      const colors = { 'A+': '#198754', 'A': '#198754', 'B+': '#0d6efd', 'B': '#6c757d', 'C': '#fd7e14', 'D': '#dc3545', 'F': '#842029' };
      if (this._charts.grade) this._charts.grade.destroy();
      this._charts.grade = new Chart(ctx, {
        type: 'bar',
        data: { labels: order, datasets: [{ data, backgroundColor: order.map((g) => colors[g]) }] },
        options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { stepSize: 1 } } } },
      });
    },
    _drawFactorAvg() {
      const ctx = document.getElementById('factorAvgChart');
      if (!ctx || !this.top.length) return;
      const avg = (k) => this.top.reduce((a, b) => a + (b[k] || 0), 0) / this.top.length;
      if (this._charts.factorAvg) this._charts.factorAvg.destroy();
      this._charts.factorAvg = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: ['가치', '모멘텀', '퀄리티', '저변동', '성장'],
          datasets: [{
            data: [avg('value_score'), avg('momentum_score'), avg('quality_score'), avg('volatility_score'), avg('growth_score')],
            backgroundColor: ['#0d6efd', '#198754', '#fd7e14', '#6f42c1', '#dc3545'],
          }],
        },
        options: {
          indexAxis: 'y',
          plugins: { legend: { display: false } },
          scales: { x: { min: 0, max: 100 } },
        },
      });
    },

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
      for (const s of scores) {
        const i = Math.min(9, Math.max(0, Math.floor(s / 10)));
        bins[i]++;
      }
      const labels = bins.map((_, i) => `${i*10}-${i*10+10}`);
      const colors = bins.map((_, i) => this.scoreColor(i * 10 + 5));
      if (this._charts.dist) this._charts.dist.destroy();
      this._charts.dist = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{ label: '종목 수', data: bins, backgroundColor: colors }] },
        options: { plugins: { legend: { display: false } } },
      });
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
      this._charts.factor = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets },
        options: { indexAxis: 'y', plugins: { legend: { position: 'bottom' } }, scales: { x: { max: 100, stacked: true }, y: { stacked: true } } },
      });
    },

    _drawNavChart() {
      const ctx = document.getElementById('navChart');
      if (!ctx || !this.bt.result?.nav) return;
      if (this._charts.nav) this._charts.nav.destroy();
      this._charts.nav = new Chart(ctx, {
        type: 'line',
        data: {
          labels: this.bt.result.nav.map((n) => n.idx),
          datasets: [{ label: 'NAV', data: this.bt.result.nav.map((n) => n.value), borderColor: '#0d6efd', tension: 0.1, pointRadius: 0, fill: true, backgroundColor: 'rgba(13,110,253,0.1)' }],
        },
        options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: false } } },
      });
    },

    // ----- 종목 상세 -----
    async openStock(code) {
      try {
        const r = await window.apiGet('/api/stock/' + encodeURIComponent(code));
        if (r && r.__error) return;
        if (!r || !r.stock) return;
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

    _drawStockCharts() {
      this._drawPriceChart();
      this._drawVolumeChart();
      this._drawRadarChart();
    },

    _drawPriceChart() {
      const ctx = document.getElementById('priceChart');
      if (!ctx || !this.stockDetail?.prices) return;
      const sorted = [...this.stockDetail.prices].sort((a, b) => new Date(a.date) - new Date(b.date));
      const labels = sorted.map((p) => p.date);
      const data = sorted.map((p) => p.close);
      if (this._charts.price) this._charts.price.destroy();
      this._charts.price = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets: [{ label: '종가', data, borderColor: '#0d6efd', tension: 0.15, pointRadius: 0 }] },
        options: { plugins: { legend: { display: false } }, scales: { x: { display: false } } },
      });
    },

    _drawVolumeChart() {
      const ctx = document.getElementById('volumeChart');
      if (!ctx || !this.stockDetail?.prices) return;
      const sorted = [...this.stockDetail.prices].sort((a, b) => new Date(a.date) - new Date(b.date));
      const labels = sorted.map((p) => p.date);
      const data = sorted.map((p) => p.volume);
      if (this._charts.vol) this._charts.vol.destroy();
      this._charts.vol = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{ label: '거래량', data, backgroundColor: '#6c757d' }] },
        options: { plugins: { legend: { display: false } }, scales: { x: { display: false } } },
      });
    },

    _drawRadarChart() {
      const ctx = document.getElementById('radarChart');
      if (!ctx || !this.stockDetail?.score) return;
      const s = this.stockDetail.score;
      const data = [s.value_score, s.momentum_score, s.quality_score, s.volatility_score, s.growth_score];
      if (this._charts.radar) this._charts.radar.destroy();
      this._charts.radar = new Chart(ctx, {
        type: 'radar',
        data: {
          labels: ['가치', '모멘텀', '퀄리티', '저변동', '성장'],
          datasets: [{
            label: this.stockDetail.stock.name,
            data,
            backgroundColor: 'rgba(13,110,253,0.2)',
            borderColor: '#0d6efd',
            pointBackgroundColor: '#0d6efd',
          }],
        },
        options: {
          scales: { r: { min: 0, max: 100, ticks: { stepSize: 20 } } },
          plugins: { legend: { display: false } },
        },
      });
    },

    // ----- 갱신 -----
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
