'use strict';

// ?Ä???¨Ïûê ?Ä?úÎ≥¥??
// - ?∏Ïä§??Vercel): /api/* ??/data/*.json Î¶¨Îùº?¥Ìä∏ (?ïÏ†Å ?∞Ïù¥??
// - Î°úÏª¨: /api/* ??Express + DuckDB
// ?ëÏ™Ω Î™®Îëê apiGet() ?ºÎ°ú ?ïÍ∑ú??

function app() {
  return {
    // ----- ?ÅÌÉú -----
    tab: 'top',
    // ?òÏù¥ÏßÄ Í∞êÏ?: 'main' | 'explore' | 'analysis'
    page: (() => {
      const p = (typeof location !== 'undefined' ? location.pathname : '/');
      if (p.endsWith('/explore')) return 'explore';
      if (p.endsWith('/analysis')) return 'analysis';
      return 'main';
    })(),
    hosted: false,
    marketFilter: 'KOSPI',  // Í∏∞Î≥∏ KOSPIÎß?(KOSDAQ?Ä Î≥ÑÎèÑ ?òÏù¥ÏßÄ)
    darkMode: false,
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
    currentWeights: { value: 10, momentum: 25, quality: 25, volatility: 15, growth: 15, liquidity: 5, supply: 5 },

    indices: [],
    all: [],
    top: [],
    logs: [],
    meta: { markets: [], sectors: [], last_price_date: '', last_score_date: '', factor_stats: null },
    filter: { q: '', market: '', sector: '', grade: '' },
    stockDetail: null,
    detailTab: 'overview',
    heatmap: [],
    heatmapLimit: 80,
    sectorData: { markets: [], sectors: [] },
    correlation: { keys: [], matrix: {} },

    // ?†Í∑ú Í∏∞Îä• ?ÅÌÉú
    watchlist: [],
    compareSet: [],
    gainers: [],
    losers: [],
    moversAsOf: '',     // movers.json Í∞±Ïã† ?úÍ∞Å
    moversPeriod: '',   // ?∞Ïù¥??Í∏∞Ï????§Î™Ö
    newHighs: [],
    newLows: [],
    strongBuy: [],
    strongSell: [],
    portfolio: null,
    portfolioLoading: false,
    signalPerformance: null,  // KOSPI ?†Ìò∏ Ï∂îÏ†Å (Î∞±ÌïÑ Í≤∞Í≥º)
    signalPerformanceKosdaq: null,  // KOSDAQ ?†Ìò∏ Ï∂îÏ†Å (Î≥ÑÎèÑ JSON)
    matrixVerifyKospi: null,  // KOSPI Îß§Ìä∏Î¶?ä§ Í≤ÄÏ¶?Top 200
    matrixVerifyKosdaq: null,  // KOSDAQ Îß§Ìä∏Î¶?ä§ Í≤ÄÏ¶?Top 200
    matrixMarketFilter: 'compare',  // Îß§Ìä∏Î¶?ä§ Î∂ÑÏÑù ???ÑÌÑ∞: 'KOSPI' | 'KOSDAQ' | 'compare'
    marketRegime: null,  // ?úÏû• ?âÍ? ?êÏàò (1-100)
    marketRegimeLoading: false,
    gradePerformance: null,  // ?±Í∏âÎ≥??†Ìò∏ ?òÏùµÎ•?(KOSPI/KOSDAQ)
    gradePerformanceLoading: false,
    marketRegimeHistory: null,  // ?úÏû• ?âÍ? ?êÏàò ?úÍ≥Ñ??(60??
    analytics: null,
    analyticsLoading: false,
    _analyticsCharts: {},
    briefing: '',
    realtime: null,  // ?§ÏãúÍ∞??úÏÑ∏ (TOP 20)
    realtimeLastFetch: 0,
    _realtimeTimer: null,
    notifications: [],  // ?∏Ïï± ?åÎ¶º
    notifOpen: false,  // ?åÎ¶º ?®ÎÑê ?¥Î¶º/?´Ìûò
    notifUnreadCount: 0,  // ?àÏùΩ??Ïπ¥Ïö¥??
    distGradeFilter: null,  // Î∂ÑÌè¨ ?±Í∏â ?ÑÌÑ∞ (null=?ÑÏ≤¥, 'A+', 'A', ...)
    distSectorFilter: null,  // Î∂ÑÌè¨ ?πÌÑ∞ ?ÑÌÑ∞

    // ?µÌã∞ÎßàÏù¥?Ä + Î∞±ÌÖå?§Ìä∏
    optimizer: { ok: false, error: 'Î°úÎî© Ï§?..' },
    backtest: { ok: false, error: 'Î°úÎî© Ï§?..' },
    dynamicPortfolio: null,  // ?ôÏ†Å Î¶¨Î∞∏?∞Ïã± (13Í∞úÏõî top 10 byStock ?¥Î†•)

    _charts: {},
    _modal: null,
    _refreshTimer: null,
    _tabDraws: { chart: false, backtest: false, corr: false, heatmap: false, sector: false, movers: false, highlow: false, supply: false, watchlist: false },

    // ----- Ï¥àÍ∏∞??-----
    async init() {
      this._modal = new bootstrap.Modal(document.getElementById('stockModal'));

      // Î™®Îã¨ ?ÑÏ†Ñ???¥Î¶∞ ??Ï∞®Ìä∏ Í∑∏Î¶¨Í∏?(transition ?ÄÍ∏?
      document.getElementById('stockModal').addEventListener('shown.bs.modal', () => {
        // Chart.js lazy Î°úÎìú (Î™®Îã¨??chart-heavy???òÏù¥ÏßÄ ÏßÑÏûÖ Í≤ΩÎ°ú)
        if (window.ChartLoader && !window.ChartLoader.isLoaded()) {
          window.ChartLoader.ready().then(() => {
            this.$nextTick(() => this._drawStockCharts());
          }).catch((e) => console.warn('[modal] chart load:', e));
        } else {
          this.$nextTick(() => this._drawStockCharts());
        }
      });
      // Î™®Îã¨ ?´Ìûê ??Î™®Îì† chart destroy (Î©îÎ™®Î¶?leak Î∞©Ï?)
      document.getElementById('stockModal').addEventListener('hidden.bs.modal', () => {
        this._destroyModalCharts();
        this.stockDetail = null;  // ???∞Ïù¥???¥Ï†ú
      });

      this.strategies = Object.values(window.QUANT_STRATEGIES || {});
      // ?êÎèô ÏµúÏ†Å?îÎêú best Í∞ÄÏ§ëÏπòÎ•??∞ÏÑ† Ï±ÑÌÉù (?¨Ïö©???òÎèô Î≥ÄÍ≤??ÜÏùÑ ??
      try {
        const opt = await window.apiGet('/api/optimizer');
        if (opt && opt.ok !== false && opt.best && opt.best.weights) {
          // auto-best ?ÑÎûµ??strategies ?ûÏóê Ï∂îÍ?
          this.strategies = [
            {
              key: 'auto-best',
              name: '?éØ ?êÎèô ÏµúÏ†Å (Sharpe ' + (opt.best.sharpe || 0).toFixed(2) + ')',
              emoji: '?éØ',
              description: '13Í∞úÏõî historical ?úÎ? ?êÎèô ÏµúÏ†Å. Total ' + ((opt.best.total || 0) * 100).toFixed(0) + '% / MDD ' + ((opt.best.mdd || 0) * 100).toFixed(1) + '%',
              weights: opt.best.weights,
            },
            ...this.strategies,
          ];
          this.strategyKey = 'auto-best';
          this.currentWeights = opt.best.weights;
        } else {
          this.currentWeights = window.QUANT_STRATEGIES[this.strategyKey].weights;
        }
      } catch (e) {
        this.currentWeights = window.QUANT_STRATEGIES[this.strategyKey].weights;
      }

      // localStorage?êÏÑú Í¥Ä?¨Ï¢ÖÎ™?+ ?§ÌÅ¨Î™®Îìú + Í∞ÄÏ§ëÏπò Î≥µÏõê
      // localStorage ?àÏ†Ñ ?ΩÍ∏∞ (?êÏÉÅ ??fallback)
      try { this.watchlist = JSON.parse(localStorage.getItem('quant_watchlist') || '[]') || []; } catch (e) { console.warn('[init] watchlist ?êÏÉÅ, Ï¥àÍ∏∞??); this.watchlist = []; }
      try { const savedWeights = JSON.parse(localStorage.getItem('quant_weights') || 'null'); if (savedWeights) this.currentWeights = savedWeights; } catch (e) { /* ignore */ }
      if (savedWeights) this.currentWeights = savedWeights;
      const savedDark = (() => { try { return localStorage.getItem('quant_darkmode'); } catch (e) { return null; } })();
      if (savedDark === '1') { this.darkMode = true; document.body.classList.add('dark-mode'); }

      // ????úºÎ°??ÑÌôò?òÎ©¥ ?¥Îãπ Ï∞®Ìä∏ ?§Ïãú Í∑∏Î¶¨Í∏?
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

      // URL?êÏÑú ?åÎùºÎØ∏ÌÑ∞ ?ΩÍ∏∞
      const urlParams = new URLSearchParams(window.location.search);
      const m = urlParams.get('market');
      if (m === 'KOSPI' || m === 'KOSDAQ') this.marketFilter = m;
      const code = urlParams.get('code');
      if (code) setTimeout(() => this.openStock(code), 1500);

      // Chart.js ?¨Ï†Ñ ?ïÏù∏ (CDN Î°úÎìú ???êÏúºÎ©?fallback)
      if (typeof window.Chart === 'undefined') {
        console.warn('[init] Chart.js ÎØ∏Î°ú????Ï∞®Ìä∏ Í∏∞Îä• ÎπÑÌôú?±Ìôî');
      } else {
        console.log('[init] Chart.js Î°úÎìú OK, v' + (window.Chart.version || 'unknown'));
      }

      // Î∂ÑÏÑù ?∞Ïù¥??ÎØ∏Î¶¨ fetch (???úÏûë ??Ï∫êÏãú)
      setTimeout(() => { this.loadAnalytics().catch((e) => console.warn('[init] analytics prefetch failed:', e)); }, 2000);
      // ?ôÏ†Å ?¨Ìä∏?¥Î¶¨??ÎØ∏Î¶¨ fetch (stock detail?êÏÑú ?¨Ïö©)
      setTimeout(() => { this.loadDynamicPortfolio().catch((e) => console.warn('[init] dynamic-portfolio prefetch failed:', e)); }, 2500);

      // tab Î≥ÄÍ≤???Ï∞®Ìä∏ ?§Ïãú Í∑∏Î¶¨Í∏?(display:none Î¨∏Ï†ú ?¥Í≤∞)
      this.$watch('tab', (t) => {
        if (!t) return;
        this.$nextTick(() => {
          if (t === 'chart') { try { this.drawCharts(); } catch (e) { console.error('[chart]', e); } }
          else if (t === 'backtest') { this.loadBacktest(); }
          else if (t === 'corr') { this.loadCorrelation(); }
          else if (t === 'heatmap') { this.loadHeatmap(); }
          else if (t === 'sector') { this.loadSectors(); }
          else if (t === 'top') { this._drawTopCharts(); }
          else if (t === 'movers') { this.loadMovers(); }
          else if (t === 'highlow') { this.loadHighLow(); }
          else if (t === 'supply') { this.loadSupplySignals(); }
          else if (t === 'portfolio') { this.loadPortfolio(); }
          // analytics??setTab()?êÏÑúÎß?Ï≤òÎ¶¨ (Ï§ëÎ≥µ Î∞©Ï?)
          else if (t === 'watchlist') { this._tabDraws.watchlist = true; }
        });
      });

      // ?§ÌÅ¨Î™®Îìú ?†Í? ??class ?ÅÏö©
      this.$watch('darkMode', (v) => {
        document.body.classList.toggle('dark-mode', v);
        try { localStorage.setItem('quant_darkmode', v ? '1' : '0'); } catch (e) { /* quota exceeded ??*/ }
      });

      // Í∞ÄÏ§ëÏπò Î≥ÄÍ≤????êÎèô ?Ä??
      this.$watch('currentWeights', (w) => {
        try { localStorage.setItem('quant_weights', JSON.stringify(w)); } catch (e) { /* ignore */ }
        this._recomputeAndSet();
      });

      // ?§Î≥¥???®Ï∂ï??
      document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        // setTab()???òÏù¥ÏßÄ navigate ?êÎèô Ï≤òÎ¶¨ ???®Ï∂ï?§Îäî setTabÎß??∏Ï∂ú
        if (e.key === 't' || e.key === 'T') { e.preventDefault(); this.setTab('top'); }
        else if (e.key === 'h' || e.key === 'H') { e.preventDefault(); this.setTab('highlow'); }
        else if (e.key === 'b' || e.key === 'B') { e.preventDefault(); this.setTab('backtest'); }
        else if (e.key === 'm' || e.key === 'M') { e.preventDefault(); this.setTab('movers'); }
        else if (e.key === 'w' || e.key === 'W') { e.preventDefault(); this.setTab('watchlist'); }
        else if (e.key === 'a' || e.key === 'A') { e.preventDefault(); this.setTab('analytics'); }  // Î©îÏù∏/Î∂ÑÏÑù ?ëÏ™Ω?êÏÑú ?ôÏûë
        else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); this.setTab('portfolio'); }  // Î©îÏù∏/Î∂ÑÏÑù ?ëÏ™Ω?êÏÑú ?ôÏûë
        else if (e.key === '?') { e.preventDefault(); this.showShortcuts(); }
        else if (e.key === 'c' || e.key === 'C') { e.preventDefault(); this.openCompare(); }
        else if (e.key === 'n' || e.key === 'N') {
          e.preventDefault();
          const code = this.stockDetail?.stock?.code || this.selectedCode;
          if (code) this.openNaver(code);
        } else if (e.key === 'd' || e.key === 'D') {
          // ?§ÏùåÏ¶ùÍ∂å: ?ÑÏû¨ Î≥¥Í≥† ?àÎäî Ï¢ÖÎ™© ?êÎäî TOP 1
          e.preventDefault();
          const code = this.stockDetail?.stock?.code || this.selectedCode || this.top?.[0]?.code;
          if (code) this.openDaum(code);
        } else if (e.key === 's' || e.key === 'S') {
          e.preventDefault();
          this.toggleDark();
        } else if (e.key === 'Escape') {
          if (this._modal && document.getElementById('stockModal').classList.contains('show')) this._modal.hide();
          if (this._compareModal && document.getElementById('compareModal').classList.contains('show')) this._compareModal.hide();
        }
      });

      // URL ?tab= ÏøºÎ¶¨Î°??òÏù¥ÏßÄ ÏßÑÏûÖ ???¥Îãπ ???úÏÑ±??
      const params = new URLSearchParams(location.search);
      const initialTab = params.get('tab');
      if (initialTab) this.tab = initialTab;

      // ?òÏù¥ÏßÄÎ≥?Ï¥àÍ∏∞ fetch ??Î¨¥Í±∞???∞Ïù¥?∞Îäî lazy, ?òÏù¥ÏßÄ??Í∞ÄÎ≥çÍ≤å
      const fetches = [
        this.loadHealth(),
        this.loadMeta(),
        this.loadIndices(),
      ];
      if (this.page === 'main') {
        fetches.push(this.loadTop());         // Î©îÏù∏: TOP 20 (6KB)
        fetches.push(this.loadRealtime());    // Î©îÏù∏: ?§ÏãúÍ∞?Í∞ÄÍ≤?
        fetches.push(this.loadMarketRegime()); // ?úÏû• ?âÍ? ?êÏàò
      } else if (this.page === 'analysis') {
        fetches.push(this.loadLogs());
        fetches.push(this.loadOptimizer());
        fetches.push(this.loadBacktest());
        fetches.push(this.loadMarketRegime());  // ?úÏû• ?âÍ? ?êÏàò
        fetches.push(this.loadMatrixVerify());  // Îß§Ìä∏Î¶?ä§ Í≤ÄÏ¶?KOSPI/KOSDAQ
      }
      // explore: Ï≤???ßå lazy fetch (?¨Ïö©???¥Î¶≠ ??
      fetches.push(this.loadNotifications());
      await Promise.all(fetches);

      this._recomputeAndSet();
      // Chart.js Î∞±Í∑∏?ºÏö¥???ÑÎ¶¨Î°úÎìú (?¨Ïö©?êÍ? Ï∞®Ìä∏ ???¥Î¶≠ ??Ï¶âÏãú ?¨Ïö© Í∞Ä??
      if (window.ChartLoader && !window.ChartLoader.isLoaded()) {
        window.ChartLoader.preload();
      }
      // Î©îÏù∏ ?òÏù¥ÏßÄ?êÏÑúÎß?sparkline Í∑∏Î¶¨Í∏?(?êÏÉâ/Î∂ÑÏÑù?Ä ?§Î•∏ Ï∞®Ìä∏)
      if (this.page === 'main') {
        this.$nextTick(() => this._drawAllSparklines());
        this._generateBriefing();
        this._startRealtimePolling();
      }
      // ?êÎèô ?àÎ°úÍ≥†Ïπ® OFF (?òÎèô ?àÎ°úÍ≥†Ïπ® Î≤ÑÌäº?ºÎ°úÎß? ??CPU/Î©îÎ™®Î¶?Î≥¥Ìò∏
    },

    // ===== factor ?µÍ≥Ñ =====
    factorStatsTotal() {
      const s = this.meta?.factor_stats;
      if (!s) return '??;
      return (s.halt || 0) + (s.zeroVolume || 0) + (s.caution || 0) + (s.veryLowLiq || 0) + (s.lowLiquidity || 0) + (s.cautionLiq || 0);
    },
    factorStatsBreakdown() {
      const s = this.meta?.factor_stats;
      if (!s) return '';
      const parts = [];
      if (s.halt) parts.push(`?ö´${s.halt}`);
      if (s.zeroVolume) parts.push(`0vol ${s.zeroVolume}`);
      if (s.caution) parts.push(`?†Ô∏è${s.caution}`);
      if (s.veryLowLiq) parts.push(`?íß?íß${s.veryLowLiq}(<1??`);
      if (s.lowLiquidity) parts.push(`?íß${s.lowLiquidity}(1~5??`);
      if (s.cautionLiq) parts.push(`?íß${s.cautionLiq}(5~10??`);
      return parts.length > 0 ? parts.join(' / ') : '?ïÏÉÅ';
    },

    _destroyModalCharts() {
      // Î™®Îã¨ ?àÏùò Î™®Îì† chart ?∏Ïä§?¥Ïä§ destroy (Chart.js Î©îÎ™®Î¶?leak Î∞©Ï?)
      const keys = ['price', 'vol', 'radar', 'supply', 'holding', 'ma', 'rsi', 'macd', 'bb', 'weight', 'contrib', 'imp'];
      for (const k of keys) {
        if (this._charts[k]) { try { this._charts[k].destroy(); } catch (_) {} this._charts[k] = null; }
      }
    },

    // ÎπÑÍµê Î™®Îã¨ ?¥Í∏∞
    openCompareModal() {
      if (this.compareSet.length < 2) { alert('2Í∞??¥ÏÉÅ ?†ÌÉù?¥Ï£º?∏Ïöî'); return; }
      const el = document.getElementById('compareModal');
      if (!this._compareModal) this._compareModal = new bootstrap.Modal(el);
      this._compareModal.show();
    },

    async manualRefresh() {
      // ?òÎèô ?àÎ°úÍ≥†Ïπ® ???¨Ïö©?êÍ? Î≤ÑÌäº ?åÎ????åÎßå ?∏Ï∂ú
      const btn = document.querySelector('[data-action="refresh"]');
      if (btn) { btn.disabled = true; btn.textContent = 'Í∞±Ïã† Ï§?..'; }
      try { await this._silentRefresh(); }
      finally {
        if (btn) { btn.disabled = false; btn.textContent = '?îÑ ?àÎ°úÍ≥†Ïπ®'; }
      }
    },

    async setTab(t) {
      // ?ÑÏû¨ ?òÏù¥ÏßÄ???ÜÎäî ??? ?¥Îãπ ?òÏù¥ÏßÄÎ°?navigate (?tab= ÏøºÎ¶¨Î°?ÏßÑÏûÖ)
      const mainTabs = ['top', 'watchlist'];
      const exploreTabs = ['movers', 'highlow', 'heatmap', 'all', 'sector', 'supply'];
      const analysisTabs = ['distribution', 'corr', 'optimizer', 'backtest', 'analytics', 'logs'];
      // shared: ?ëÏ™Ω ?òÏù¥ÏßÄ??Î™®Îëê ?àÎäî ??(navigate Î∂àÌïÑ??
      const sharedTabs = ['portfolio'];
      if (this.page === 'main' && !sharedTabs.includes(t) && (exploreTabs.includes(t) || analysisTabs.includes(t))) {
        const target = exploreTabs.includes(t) ? '' : '';
        location.href = `/${target}?tab=${t}`;
        return;
      }
      if (this.page === 'explore' && !sharedTabs.includes(t) && (mainTabs.includes(t) || analysisTabs.includes(t))) {
        const target = mainTabs.includes(t) ? '/' : '';
        location.href = `${target}?tab=${t}`;
        return;
      }
      if (this.page === 'analysis' && !sharedTabs.includes(t) && (mainTabs.includes(t) || exploreTabs.includes(t))) {
        const target = mainTabs.includes(t) ? '/' : '';
        location.href = `${target}?tab=${t}`;
        return;
      }
      const oldTab = this.tab;
      this.tab = t;
      // ?¥Ï†Ñ fetch Ï∑®ÏÜå (race condition Î∞©Ï?)
      if (this._currentFetchCtl) { try { this._currentFetchCtl.abort(); } catch (e) {} }
      this._currentFetchCtl = new AbortController();
      // ?¥Ï†Ñ Ï∞®Ìä∏ destroy (Î©îÎ™®Î¶??ÑÏàò Î∞©Ï?)
      if (oldTab && oldTab !== t) this._destroyAllCharts();
      // Chart.js lazy Î°úÎìú: Ï∞®Ìä∏ Í∑∏Î¶¨Í∏??ÑÏóê Î°úÎìú Î≥¥Ïû• (Ï≤?1?åÎßå ~150ms, ?¥ÌõÑ Ï∫êÏãú)
      if (window.ChartLoader && !window.ChartLoader.isLoaded()) {
        try { await window.ChartLoader.ready(); } catch (e) { console.warn('[setTab] chart loader:', e); }
      }
      // canvas ?åÎçîÎß?Î≥¥Ïû•???ÑÌï¥ $nextTick ?Ä??setTimeout (50ms ??
      // Alpine.js x-show + $nextTick race condition ?åÌîº
      setTimeout(() => {
        try {
          if (t === 'heatmap') { this.loadHeatmap(); setTimeout(() => this._drawHeatmap(), 100); }
          else if (t === 'sector') { this.loadSectors(); }
          else if (t === 'chart') { this.drawCharts(); }
          else if (t === 'corr') { this.loadCorrelation(); setTimeout(() => this._drawCorrelation(), 100); }
          else if (t === 'optimizer') { this.loadOptimizer(); setTimeout(() => this._drawOptimizer(), 100); }
          else if (t === 'backtest') { this.loadBacktest(); setTimeout(() => this._drawBacktestCharts(), 100); }
          else if (t === 'portfolio') { this.loadPortfolio(); }
          else if (t === 'analytics') { this.loadAnalytics(); setTimeout(() => this._drawAnalyticsCharts(), 100); }
          else if (t === 'signals') {
            this.loadSignalPerformance();
            this.loadMatrixVerify();
            this.loadMarketRegime();
            this.loadGradePerformance();
            this.loadMarketRegimeHistory();
            setTimeout(() => { this._drawSignalCharts(); this._drawMatrixCharts(); this._drawGradeChart(); this._drawMarketHistoryChart(); }, 100);
          }
          else if (t === 'top') { this._drawTopCharts(); }
          else if (t === 'movers') { this.loadMovers(); }
          else if (t === 'highlow') { this.loadHighLow(); }
          else if (t === 'supply') { this.loadSupplySignals(); }
          else if (t === 'watchlist') { this._drawTopCharts(); }
        } catch (e) { console.error('[setTab]', t, e); }
      }, 50);
    },

    // === Î™®Îì† Ï∞®Ìä∏ destroy (Î©îÎ™®Î¶??ÑÏàò Î∞©Ï?) ===
    _destroyAllCharts() {
      for (const k of Object.keys(this._charts || {})) {
        try { if (this._charts[k] && this._charts[k].destroy) this._charts[k].destroy(); } catch (e) { /* ignore */ }
        delete this._charts[k];
      }
      for (const k of Object.keys(this._analyticsCharts || {})) {
        try { if (this._analyticsCharts[k] && this._analyticsCharts[k].destroy) this._analyticsCharts[k].destroy(); } catch (e) { /* ignore */ }
        delete this._analyticsCharts[k];
      }
    },

    // === ?àÏ†Ñ??Ï∞®Ìä∏ Í∑∏Î¶¨Í∏?(canvas width 0 / Chart.js ?êÎü¨ Î∞©Ï?) ===
    _safeDraw(canvasId, drawFn) {
      const c = document.getElementById(canvasId);
      if (!c) { console.warn(`[${canvasId}] not found`); return false; }
      if (c.clientWidth === 0) { console.warn(`[${canvasId}] canvas width=0, skip`); return false; }
      try { drawFn(c); console.log(`[${canvasId}] OK`); return true; }
      catch (e) { console.error(`[${canvasId}] error:`, e); return false; }
    },

    // === ?àÏ†Ñ??fetch (10Ï¥?timeout) ===
    async _safeFetch(url, ms = 10000) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), ms);
      try {
        const r = await fetch(url, { signal: ctl.signal });
        clearTimeout(t);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
      } catch (e) {
        clearTimeout(t);
        throw e;
      }
    },

    _drawCorrelation() {
      // ?ÅÍ? ?âÎ†¨?Ä HTMLÎ°?ÏßÅÏ†ë Í∑∏Î†§???àÏñ¥ Î≥ÑÎèÑ ?ëÏóÖ ?ÜÏùå
    },
    _drawOptimizer() {
      try {
        const c = document.getElementById('chartOptimizerCompare');
        if (!c || c.clientWidth === 0) return;
        const data1 = this.optimizer?.best || { sharpe: 0, total: 0, mdd: 0 };
        // 2Ï∞??åÍ? Í≤∞Í≥º: fetch
        Promise.all([
          window.apiGet('/api/regression-2').catch(() => null),
        ]).then(([r2]) => {
          const data2 = r2?.finalBest || r2?.best || { sharpe: 0, total: 0, mdd: 0 };
          const labels = ['1Ï∞??åÍ? (?∏ÏÉ§?Ä)', '2Ï∞??åÍ? (Ridge+5fold)'];
          const sharpes = [data1.sharpe || 0, data2.sharpe || 0];
          const totals = [(data1.total || 0) * 100, (data2.total || 0) * 100];
          const mdds = [(data1.mdd || 0) * 100, (data2.mdd || 0) * 100];
          if (this._charts.optCmp) this._charts.optCmp.destroy();
          this._charts.optCmp = new Chart(c, {
            type: 'bar',
            data: {
              labels,
              datasets: [
                { label: 'Sharpe √ó 100', data: sharpes.map((v) => v * 100), backgroundColor: 'rgba(75, 192, 75, 0.7)' },
                { label: 'Total (%)', data: totals, backgroundColor: 'rgba(54, 162, 235, 0.7)' },
                { label: 'MDD (% ?åÏàò)', data: mdds, backgroundColor: 'rgba(255, 99, 132, 0.7)' },
              ],
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } }, scales: { y: { ticks: { callback: (v) => v + (Math.abs(v) >= 10 ? '%' : '') } } } },
          });
          console.log('[chartOptimizerCompare] OK');
        });
      } catch (e) { console.error('[chartOptimizerCompare] error:', e); }
    },
    _drawHeatmap() {},

    onStrategyChange() {
      const s = this.strategies.find((x) => x.key === this.strategyKey);
      if (s) this.currentWeights = { ...s.weights };
      this._recomputeAndSet();
    },

    currentStrategy() {
      return this.strategies.find((s) => s.key === this.strategyKey);
    },

    async _silentRefresh() {
      try {
        // ?òÏù¥ÏßÄÎ≥ÑÎ°ú ?ÑÏöî??fetchÎß?
        const fetches = [this.loadHealth(), this.loadMeta(), this.loadIndices()];
        if (this.page === 'main') {
          fetches.push(this.loadTop(), this.loadRealtime());
        } else if (this.page === 'explore') {
          // loadAll?Ä ?¥Î? Î©îÎ™®Î¶¨Ïóê ?àÏùÑ Í∞Ä?•ÏÑ± ??(???¥Î¶≠ ??lazy)
        } else if (this.page === 'analysis') {
          fetches.push(this.loadLogs());
        }
        await Promise.all(fetches);
        this._recomputeAndSet();
        if (this.page === 'main') this.$nextTick(() => this._drawAllSparklines());
      } catch (e) { /* ignore */ }
    },

    _recomputeAndSet() {
      if (!this.all || this.all.length === 0) return;
      // marketFilterÎ°???Î≤????ÑÌÑ∞ (Î©îÌ??êÏÑú ?¥Î? ?úÏô∏?àÏ?Îß??àÏ†ÑÎß?
      const filtered = this.marketFilter === 'KOSPI'
        ? this.all.filter((r) => r.market === 'KOSPI' && r.total_score > 0)
        : this.all;
      const reranked = window.recomputeWithWeights(filtered, this.currentWeights);
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

    // ----- API Î°úÎìú -----
    async loadHealth() {
      try {
        const r = await window.apiGet('/api/health');
        if (r && r.__error) return;
        this.state.lastPriceDate = this._fmtDate(r.lastPriceDate);
        this.state.lastScoreDate = this._fmtDate(r.lastScoreDate);
        this.state.stockCount = r.stockCount || 0;
        this.state.lastUpdate = r.lastUpdate ? 'ÏµúÍ∑º Í∞±Ïã†: ' + r.lastUpdate : '';
        this.hosted = !!r.hosted;
      } catch (e) { /* ignore */ }
    },

    _fmtDate(d) {
      // DuckDB DATE: {days:N} ?êÎäî ISO string
      if (!d) return '??;
      if (typeof d === 'string') return d.slice(0, 10);
      if (d && typeof d === 'object' && d.days !== undefined) {
        return new Date(Date.UTC(1970, 0, 1) + d.days * 86400000).toISOString().slice(0, 10);
      }
      if (d && typeof d === 'object' && d.micros !== undefined) {
        return new Date(Math.floor(d.micros / 1000)).toISOString().slice(0, 10);
      }
      return String(d);
    },

    async loadMeta() {
      try {
        const r = await window.apiGet('/api/meta');
        if (!r || r.__error) return;
        this.meta = {
          markets: r.markets || [],
          sectors: r.sectors || [],
          stock_count: r.stock_count || 0,
          last_price_date: r.last_price_date || '',
          last_score_date: r.last_score_date || '',
          last_update: r.last_update || '',
          factor_stats: r.factor_stats || null,
          as_of: r.as_of || '',
          exclude_kosdaq: r.exclude_kosdaq || false,
        };
        // URL ?market= ?ÜÏúºÎ©?meta??exclude_kosdaqÎ°?Í≤∞Ï†ï
        if (!new URLSearchParams(window.location.search).get('market')) {
          this.marketFilter = r.exclude_kosdaq ? 'KOSPI' : 'KOSPI';
        }
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
        // KOSDAQ Î™®Îìú: Î≥ÑÎèÑ kosdaq-top.json ?¨Ïö©
        const endpoint = this.marketFilter === 'KOSDAQ' ? '/api/kosdaq-top' : '/api/scores?limit=2500';
        const r = await window.apiGet(endpoint);
        if (r && r.__error) return;
        const rows = Array.isArray(r) ? r : (r.rows || []);
        this.all = rows.map((row) => ({
          ...row,
          grade: row.grade || window.QUANT_GRADE(row.total_score),
        }));
      } catch (e) { this.all = []; }
    },

    async loadTop() {
      // ?ÅÏúÑ 20Í∞úÎßå (6KB) - Îπ†Î•∏ ?úÏûë, Î™®Î∞î??5Î∂???0.5Ï¥?
      try {
        const r = await window.apiGet('/api/top');
        if (r && r.__error) return;
        const rows = Array.isArray(r) ? r : (r.rows || []);
        this.all = rows.map((row) => ({
          ...row,
          grade: row.grade || window.QUANT_GRADE(row.total_score),
        }));
        // topN ?¨Îùº?¥Ïä§ (20)
        this.top = this.all.slice(0, this.state.topN).map((r) => ({
          ...r,
          total_score: r.recomputed_total || r.total_score,
          rank: r.recomputed_rank || r.rank,
          grade: window.QUANT_GRADE(r.recomputed_total || r.total_score),
        }));
      } catch (e) { this.all = []; this.top = []; }
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
        this.optimizer = r || { ok: false, error: '?ëÎãµ ?ÜÏùå' };
      } catch (e) {
        this.optimizer = { ok: false, error: e.message };
      }
    },

    async loadBacktest() {
      try {
        const r = await window.apiGet('/api/backtest');
        this.backtest = r || { ok: false, error: '?ëÎãµ ?ÜÏùå' };
        if (r && r.ok) this.$nextTick(() => this._drawBacktestCharts());
      } catch (e) {
        this.backtest = { ok: false, error: e.message };
      }
    },

    // ===== ?§ÏãúÍ∞??úÏÑ∏ =====
    async loadRealtime() {
      try {
        const r = await window.apiGet('/api/realtime');
        if (r && !r.__error && r.quotes) {
          this.realtime = r;
          this.realtimeLastFetch = Date.now();
          this._applyRealtimeToTop();
        }
      } catch (e) { console.warn('[realtime]', e.message); }
    },
    _startRealtimePolling() {
      // 60Ï¥àÎßà??TOP ?òÏù¥ÏßÄ ?úÏÑ± ???¥ÎßÅ (??ÎßàÍ∞ê ???úÎ≤Ñ ?ëÎãµ ?ÜÏùÑ ???àÏùå)
      if (this._realtimeTimer) clearInterval(this._realtimeTimer);
      this._realtimeTimer = setInterval(() => {
        // ?òÏù¥ÏßÄÍ∞Ä Î≥¥Ïù¥ÏßÄ ?äÏúºÎ©??¥ÎßÅ ?§ÌÇµ (Î∞∞ÌÑ∞Î¶??§Ìä∏?åÌÅ¨ Î≥¥Ìò∏)
        if (document.hidden) return;
        this.loadRealtime();
      }, 60000);
    },
    _applyRealtimeToTop() {
      // this.top Î∞∞Ïó¥??close/change/change_pct Î•?realtime Í∞íÏúºÎ°???ñ¥?∞Í∏∞
      if (!this.realtime || !this.realtime.quotes || !this.top || this.top.length === 0) return;
      const map = new Map(this.realtime.quotes.map((q) => [q.code, q]));
      let updated = 0;
      for (const t of this.top) {
        const q = map.get(t.code);
        if (q && q.close != null) {
          const newClose = Number(q.close);
          const newChange = Number(q.change) || 0;
          const newPct = Number(q.change_pct) || 0;
          if (t.close !== newClose) updated++;
          t.close = newClose;
          t.change = newChange;
          t.change_pct = newPct;
        }
      }
      if (updated > 0) console.log(`[realtime] ${updated}Í∞?Ï¢ÖÎ™© Í∞ÄÍ≤?Í∞±Ïã† (${this.realtime.fetchedAt})`);
    },
    realtimeFor(code) {
      if (!this.realtime || !this.realtime.quotes) return null;
      return this.realtime.quotes.find((q) => q.code === code) || null;
    },
    realtimeAgeMin() {
      if (!this.realtime || !this.realtime.fetchedAt) return null;
      return Math.round((Date.now() - new Date(this.realtime.fetchedAt).getTime()) / 60000);
    },
    realtimeStatus() {
      // 'live' = 5Î∂??¥ÎÇ¥, 'stale' = 30Î∂??¥ÎÇ¥, 'old' = Í∑??¥ÏÉÅ
      const age = this.realtimeAgeMin();
      if (age === null) return 'none';
      if (age <= 5) return 'live';
      if (age <= 30) return 'stale';
      return 'old';
    },
    realtimeColor() {
      const s = this.realtimeStatus();
      if (s === 'live') return '#198754';   // Ï¥àÎ°ù
      if (s === 'stale') return '#fd7e14';  // Ï£ºÌô©
      if (s === 'old') return '#6c757d';    // ?åÏÉâ
      return '#dc3545';                      // Îπ®Í∞ï (?ÜÏùå/?êÎü¨)
    },

    // ===== ?∏Ïï± ?åÎ¶º =====
    loadNotifications() {
      // 1) localStorage?êÏÑú Í∏∞Ï°¥ ?åÎ¶º Î°úÎìú
      try { this.notifications = window.NotifStore.load(); } catch (e) { this.notifications = []; }
      this._updateNotifUnread();
      // 2) ?ÑÏû¨ ?∞Ïù¥?∞Î°ú ???åÎ¶º ?ùÏÑ± + Î≥ëÌï©
      try {
        const newOnes = window.NotifStore.generateFromData({
          portfolio: this.portfolio,
          top: this.top,
          distribution: this.distribution,
          movers: { gainers: this.gainers, losers: this.losers },
          supplySignals: this.supplySignals || { buy: [] },
          log: this.logs,
        });
        if (newOnes.length > 0) {
          this.notifications = window.NotifStore.mergeAndSave(newOnes);
          this._updateNotifUnread();
        }
      } catch (e) { console.warn('[notif] generate failed:', e); }
    },
    _updateNotifUnread() {
      this.notifUnreadCount = this.notifications.filter((n) => !n.read).length;
    },
    toggleNotifPanel() {
      this.notifOpen = !this.notifOpen;
      // ?®ÎÑê ?¥Î©¥ Î™®Îëê ?ΩÏùå Ï≤òÎ¶¨
      if (this.notifOpen && this.notifUnreadCount > 0) {
        this.notifications = this.notifications.map((n) => ({ ...n, read: true }));
        try { window.NotifStore.markAllRead(); } catch (e) {}
        this.notifUnreadCount = 0;
      }
    },
    markAllNotifRead() {
      this.notifications = this.notifications.map((n) => ({ ...n, read: true }));
      try { window.NotifStore.markAllRead(); } catch (e) {}
      this.notifUnreadCount = 0;
    },
    clearNotifs() {
      if (!confirm('Î™®Îì† ?åÎ¶º????†ú?òÏãúÍ≤†Ïäµ?àÍπå?')) return;
      try { window.NotifStore.clear(); } catch (e) {}
      this.notifications = [];
      this.notifUnreadCount = 0;
    },
    openNotif(n) {
      if (n.code) this.openStock(n.code);
      this.notifOpen = false;
    },
    notifTimeAgo(iso) {
      if (!iso) return '';
      const t = new Date(iso).getTime();
      if (!Number.isFinite(t)) return '';
      const diff = Date.now() - t;
      const min = Math.round(diff / 60000);
      if (min < 1) return 'Î∞©Í∏à';
      if (min < 60) return `${min}Î∂???;
      const hr = Math.round(min / 60);
      if (hr < 24) return `${hr}?úÍ∞Ñ ??;
      return `${Math.round(hr / 24)}????;
    },
    notifPriorityClass(p) {
      if (p === 'high') return 'text-danger';
      if (p === 'normal') return 'text-primary';
      return 'text-muted';
    },

    forceDrawBacktest() {
      // Î∞±ÌÖå?§Ìä∏ ??Î≤ÑÌäº ?¥Î¶≠ ??(??ù¥ ÎπÑÌôú?????úÏÑ± ?úÏ†ê???∏Ï∂ú)
      this.$nextTick(() => this._drawBacktestCharts());
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

    // ----- ?§Ìåå?¨Îùº??-----
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

    // ----- ?†Ìã∏ (common.js ?ÑÏûÑ, ?òÏúÑ ?∏Ìôò) -----
    fmt(v) { return window.Q ? window.Q.fmt(v) : (v ?? '??); },
    fmtFund(v) { return window.Q ? window.Q.fmtFund(v) : (v ?? '??); },
    formatPct(v) { return window.Q ? window.Q.formatPct(v) : '??; },
    formatIdx(v) { return window.Q ? window.Q.formatIdx(v) : (v ?? '??); },
    formatCap(v) { return window.Q ? window.Q.formatCap(v) : (v ?? '??); },
    formatVolume(shares) { return window.Q ? window.Q.formatVolume(shares) : '??; },
    formatWon(won) { return window.Q ? window.Q.formatWon(won) : '??; },
    weightLabel(k) { return window.Q ? window.Q.weightLabel(k) : k; },
    factorLabel(k) { return window.Q ? window.Q.factorLabel(k) : k; },
    // scoreClass/corrColor??common.js???ôÏùº ?úÍ∑∏?àÏ≤òÎ°?Ï°¥Ïû¨
    scoreColor(s) { return window.Q ? window.Q.scoreColor(s) : '#6c757d'; },
    scoreClass(s) { return window.Q ? window.Q.scoreClass(s) : ''; },
    corrColor(r) { return window.Q ? window.Q.corrColor(r) : '#ffffff'; },
    valuationLabel(k) { return window.Q ? window.Q.valuationLabel(k) : k; },
    valuationClass(k, v) { return window.Q ? window.Q.valuationClass(k, v) : ''; },
    qualityLabel(k) { return window.Q ? window.Q.qualityLabel(k) : k; },
    qualityClass(k, v) { return window.Q ? window.Q.qualityClass(k, v) : ''; },
    analystRatingClass(rating) { return window.Q ? window.Q.analystRatingClass(rating) : 'bg-secondary'; },
    // Î∞∏Î•ò?êÏù¥???ºÎ≤®/?âÏÉÅ
    valuationLabel(k) { return ({ per: 'PER', pbr: 'PBR', psr: 'PSR', eps: 'EPS', bps: 'BPS', dividend_yield: 'Î∞∞ÎãπÎ•?%)' })[k] || k; },
    valuationClass(k, v) {
      if (v === null || v === undefined) return '';
      if (k === 'per') return v < 10 ? 'text-danger' : (v > 25 ? 'text-primary' : '');
      if (k === 'pbr') return v < 1 ? 'text-danger' : (v > 2 ? 'text-primary' : '');
      if (k === 'dividend_yield') return v >= 3 ? 'text-danger' : '';
      return '';
    },
    // ?ÑÎ¶¨???ºÎ≤®/?âÏÉÅ
    qualityLabel(k) { return ({ roe: 'ROE(%)', roa: 'ROA(%)', debt_ratio: 'Î∂ÄÏ±ÑÎπÑ??%)', operating_margin: '?ÅÏóÖ?¥ÏùµÎ•?%)', net_margin: '?úÏù¥?µÎ•†(%)' })[k] || k; },
    qualityClass(k, v) {
      if (v === null || v === undefined) return '';
      if (k === 'roe') return v >= 15 ? 'text-danger fw-bold' : (v < 5 ? 'text-primary' : '');
      if (k === 'roa') return v >= 8 ? 'text-danger fw-bold' : (v < 3 ? 'text-primary' : '');
      if (k === 'debt_ratio') return v > 200 ? 'text-primary fw-bold' : (v < 100 ? 'text-danger' : '');
      if (k === 'operating_margin') return v >= 10 ? 'text-danger fw-bold' : (v < 5 ? 'text-primary' : '');
      if (k === 'net_margin') return v >= 7 ? 'text-danger fw-bold' : (v < 3 ? 'text-primary' : '');
      return '';
    },
    // Í∞Ä??ÏµúÍ∑º fundamentals
    latestFundamental(k) {
      const f = this.stockDetail?.fundamentals || [];
      if (f.length === 0) return null;
      const cur = f[0];
      const v = Number(cur[k]);
      if (!Number.isFinite(v)) return null;
      if (k === 'operating_margin' && cur.operating_profit && cur.revenue) {
        return (Number(cur.operating_profit) / Number(cur.revenue)) * 100;
      }
      if (k === 'net_margin' && cur.net_profit && cur.revenue) {
        return (Number(cur.net_profit) / Number(cur.revenue)) * 100;
      }
      return v;
    },
    // ?†ÎÑêÎ¶¨Ïä§???±Í∏â ?âÏÉÅ
    analystRatingClass(rating) {
      if (!rating) return 'bg-secondary';
      if (rating === 'Strong Buy') return 'bg-danger';
      if (rating === 'Buy') return 'bg-warning text-dark';
      if (rating === 'Accumulate') return 'bg-info';
      if (rating === 'Hold') return 'bg-secondary';
      if (rating === 'Reduce') return 'bg-warning text-dark';
      if (rating === 'Sell') return 'bg-dark';
      return 'bg-secondary';
    },
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

    // ----- TOP Ï∞®Ìä∏ -----
    _drawTopCharts() {
      try { this._drawGradeChart(); this._drawFactorAvg(); } catch (e) { console.error('[topCharts] error:', e); }
    },
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
      this._charts.factorAvg = new Chart(ctx, { type: 'bar', data: { labels: ['Í∞ÄÏπ?, 'Î™®Î©ò?Ä', '?ÑÎ¶¨??, '?ÄÎ≥Ä??, '?±Ïû•'], datasets: [{ data: [avg('value_score'), avg('momentum_score'), avg('quality_score'), avg('volatility_score'), avg('growth_score')], backgroundColor: ['#0d6efd', '#198754', '#fd7e14', '#6f42c1', '#dc3545'] }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { min: 0, max: 100 } } } });
    },

    // ----- Î∂ÑÌè¨ -----
    async drawCharts() {
      if (!this.all || this.all.length === 0) await this.loadAll();
      this._recomputeAndSet();
      try {
        let r = null;
        try { r = await fetch('/data/distribution.json?_=' + Date.now()).then((x) => x.ok ? x.json() : null); } catch (_) { r = null; }
        const scores = (r && r.scores && r.scores.length > 0)
          ? r.scores
          : this.all.filter((x) => x.total_score > 0).map((x) => x.total_score);
        this.distribution = r;
        this._drawDist(scores);
        this._drawFactorStack();
        // Ï∂îÍ? 4Í∞?Ï∞®Ìä∏ (canvas ?åÎçî Î≥¥Ïû• ?ÑÌï¥ $nextTick ?¨Ïö©)
        this.$nextTick(() => {
          try { this._drawGradeDonut(); } catch (e) { console.error('[gradeDonut]', e); }
          try { this._drawMarket(); } catch (e) { console.error('[market]', e); }
          try { this._drawSector(); } catch (e) { console.error('[sector]', e); }
          try { this._drawFactorRadar(); } catch (e) { console.error('[factorRadar]', e); }
        });
      } catch (e) { /* ignore */ }
    },
    _drawDist(scores) {
      const ctx = document.getElementById('distChart');
      if (!ctx) return;
      // canvasÍ∞Ä Î≥¥Ïù¥???ÅÌÉú?∏Ï? ?ïÏù∏ (display:none?¥Î©¥ height 0)
      const w = ctx.clientWidth || 400;
      const h = ctx.clientHeight || 220;
      if (w === 0) { console.warn('distChart width=0, skip'); return; }
      // ?±Í∏â/?πÌÑ∞ ?ÑÌÑ∞ ?ÅÏö©
      let filtered = scores;
      if (this.distGradeFilter || this.distSectorFilter) {
        // allFactors?êÏÑú ÏΩîÎìú ??score Îß§Ìïë
        const codeMap = new Map((this.all || []).map((r) => [r.code, r]));
        filtered = scores.filter((s, idx) => {
          // scores???´Ïûê Î∞∞Ïó¥?¥Ï?Îß? ?êÎ≥∏ allFactorsÎ•??úÌöå?òÎ©¥??Îß§Ïπ≠
          // ?®Ïàú?? scores??Î∂ÑÌè¨ ?∞Ïù¥?∞Ïù¥ÎØÄÎ°? sectorFilter??Ï∂îÍ? ?∞Ïù¥???ÑÏöî
          // ???ºÎã® gradeFilterÎß??ëÎèô (sectorFilter???ÑÏÜç)
          if (!this.distGradeFilter) return true;
          // ?êÏàòÎ•??±Í∏â?ºÎ°ú Î≥Ä??
          const letter = s >= 80 ? 'A+' : s >= 70 ? 'A' : s >= 60 ? 'B+' : s >= 50 ? 'B' : s >= 40 ? 'C' : s >= 30 ? 'D' : 'F';
          return letter === this.distGradeFilter;
        });
      }
      const bins = new Array(10).fill(0);
      for (const s of filtered) { const i = Math.min(9, Math.max(0, Math.floor(s / 10))); bins[i]++; }
      const labels = bins.map((_, i) => `${i*10}-${i*10+10}`);
      const colors = bins.map((_, i) => this.distGradeFilter && (i * 10 + 5) >= this.gradeFilterMin && (i * 10 + 5) < this.gradeFilterMax ? '#0d6efd' : this.scoreColor(i * 10 + 5));
      if (this._charts.dist) this._charts.dist.destroy();
      // ?ÑÌÑ∞ ?úÏÑ± ???úÎ™© ?úÏãú
      const filterLabel = this.distGradeFilter ? ` (?±Í∏â: ${this.distGradeFilter})` : '';
      this._charts.dist = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{ label: 'Ï¢ÖÎ™© ?? + filterLabel, data: bins, backgroundColor: colors }] },
        options: { plugins: { legend: { display: true }, tooltip: { callbacks: { afterLabel: () => this.distGradeFilter ? '?ÑÌÑ∞ ?ÅÏö© Ï§????îÎ∏î?¥Î¶≠ ?¥Ï†ú' : '' } } } }
      });
    },
    _drawFactorStack() {
      const ctx = document.getElementById('factorChart');
      if (!ctx || !this.top || this.top.length === 0) return;
      const labels = this.top.map((r) => r.name.length > 6 ? r.name.slice(0, 6) + '?? : r.name);
      const datasets = [
        { label: 'Í∞ÄÏπ?, data: this.top.map((r) => r.value_score), backgroundColor: '#0d6efd' },
        { label: 'Î™®Î©ò?Ä', data: this.top.map((r) => r.momentum_score), backgroundColor: '#198754' },
        { label: '?ÑÎ¶¨??, data: this.top.map((r) => r.quality_score), backgroundColor: '#fd7e14' },
        { label: '?ÄÎ≥Ä??, data: this.top.map((r) => r.volatility_score), backgroundColor: '#6f42c1' },
        { label: '?±Ïû•', data: this.top.map((r) => r.growth_score), backgroundColor: '#dc3545' },
        { label: '?†Îèô', data: this.top.map((r) => r.liquidity_score), backgroundColor: '#20c997' },
        { label: '?òÍ∏â', data: this.top.map((r) => r.supply_score), backgroundColor: '#0dcaf0' },
      ];
      if (this._charts.factor) this._charts.factor.destroy();
      this._charts.factor = new Chart(ctx, { type: 'bar', data: { labels, datasets }, options: { indexAxis: 'y', plugins: { legend: { position: 'bottom' } }, scales: { x: { max: 100, stacked: true }, y: { stacked: true } } } });
    },

    // ----- Î∂ÑÌè¨ ?òÏù¥ÏßÄ 4Í∞?Ï∂îÍ? Ï∞®Ìä∏ -----
    _drawGradeDonut() {
      const ctx = document.getElementById('gradeDonutChart');
      if (!ctx || !this.distribution || !this.distribution.gradeCounts) return;
      if (ctx.clientWidth === 0) { console.warn('gradeDonutChart width=0, skip'); return; }
      const gc = this.distribution.gradeCounts;
      const order = ['A+', 'A', 'B+', 'B', 'C', 'D', 'F'];
      const colors = { 'A+': '#198754', 'A': '#198754', 'B+': '#0d6efd', 'B': '#6c757d', 'C': '#fd7e14', 'D': '#dc3545', 'F': '#842029' };
      const data = order.map((g) => gc[g] || 0);
      const total = data.reduce((a, b) => a + b, 0);
      if (total === 0) return;
      if (this._charts.gradeDonut) this._charts.gradeDonut.destroy();
      // ?úÏÑ± ?ÑÌÑ∞ Í∞ïÏ°∞ (offset)
      const offset = order.map((g) => this.distGradeFilter === g ? 18 : 0);
      this._charts.gradeDonut = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: order,
          datasets: [{
            data, backgroundColor: order.map((g) => colors[g]), borderWidth: 2, borderColor: '#fff', offset
          }]
        },
        options: {
          plugins: {
            legend: { position: 'right', labels: { font: { size: 11 } } },
            tooltip: { callbacks: { label: (c) => `${c.label}: ${c.parsed}Í∞?(${(c.parsed / total * 100).toFixed(1)}%) ¬∑ ?¥Î¶≠ ???ÑÌÑ∞` } }
          },
          maintainAspectRatio: false, cutout: '50%',
          onClick: (e, els) => {
            if (els && els.length > 0) {
              const g = order[els[0].index];
              this.distGradeFilter = this.distGradeFilter === g ? null : g;
              this._drawGradeDonut();
              this._drawDist();
            }
          }
        },
      });
    },
    // === Î∂ÑÌè¨ ?∏ÌÑ∞?ôÌã∞Î∏? ?ÑÌÑ∞ ===
    setDistGradeFilter(g) {
      this.distGradeFilter = this.distGradeFilter === g ? null : g;
      this._drawGradeDonut();
      this._drawDist();
    },
    setDistSectorFilter(s) {
      this.distSectorFilter = this.distSectorFilter === s ? null : s;
      this._drawSector();
      this._drawDist();
    },
    clearDistFilter() {
      this.distGradeFilter = null;
      this.distSectorFilter = null;
      this._drawGradeDonut();
      this._drawSector();
      this._drawDist();
    },
    _drawMarket() {
      const ctx = document.getElementById('marketChart');
      if (!ctx || !this.distribution || !this.distribution.marketBreakdown || this.distribution.marketBreakdown.length === 0) return;
      if (ctx.clientWidth === 0) { console.warn('marketChart width=0, skip'); return; }
      const mb = this.distribution.marketBreakdown;
      const labels = mb.map((m) => m.market);
      const colors = { KOSPI: '#0d6efd', KOSDAQ: '#fd7e14' };
      if (this._charts.market) this._charts.market.destroy();
      this._charts.market = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Ï¢ÖÎ™© ??, data: mb.map((m) => m.count), backgroundColor: labels.map((l) => colors[l] || '#6c757d'), yAxisID: 'y' },
            { label: '?âÍ∑† ?êÏàò', data: mb.map((m) => m.avg), type: 'line', borderColor: '#dc3545', backgroundColor: '#dc3545', yAxisID: 'y1', tension: 0.2 },
          ],
        },
        options: {
          plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } },
          scales: {
            y: { type: 'linear', position: 'left', beginAtZero: true, title: { display: true, text: 'Ï¢ÖÎ™© ?? } },
            y1: { type: 'linear', position: 'right', beginAtZero: true, max: 100, grid: { display: false }, title: { display: true, text: '?âÍ∑† ?êÏàò' } },
          },
        },
      });
    },
    _drawSector() {
      const ctx = document.getElementById('sectorChart');
      if (!ctx || !this.distribution || !this.distribution.sectorBreakdown || this.distribution.sectorBreakdown.length === 0) return;
      if (ctx.clientWidth === 0) { console.warn('sectorChart width=0, skip'); return; }
      const sb = this.distribution.sectorBreakdown.slice(0, 12);
      const labels = sb.map((s) => s.sector.length > 6 ? s.sector.slice(0, 6) + '?? : s.sector);
      if (this._charts.sector) this._charts.sector.destroy();
      this._charts.sector = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Ï¢ÖÎ™© ??, data: sb.map((s) => s.count), backgroundColor: '#0d6efd', yAxisID: 'y', order: 2 },
            { label: '?âÍ∑† ?êÏàò', data: sb.map((s) => s.avg), type: 'line', borderColor: '#dc3545', backgroundColor: '#dc3545', yAxisID: 'y1', tension: 0.2, order: 1 },
          ],
        },
        options: {
          indexAxis: 'y',
          plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } },
          scales: {
            x: { beginAtZero: true, title: { display: true, text: 'Ï¢ÖÎ™© ?? } },
            y: { ticks: { font: { size: 10 } } },
            y1: { display: false, beginAtZero: true, max: 100 },
          },
        },
      });
    },
    _drawFactorRadar() {
      const ctx = document.getElementById('factorRadarChart');
      if (!ctx || !this.distribution || !this.distribution.factorAvg) return;
      if (ctx.clientWidth === 0) { console.warn('factorRadarChart width=0, skip'); return; }
      const fa = this.distribution.factorAvg;
      const labels = ['Í∞ÄÏπ?, 'Î™®Î©ò?Ä', '?ÑÎ¶¨??, '?ÄÎ≥Ä??, '?±Ïû•', '?†Îèô', '?òÍ∏â'];
      const keys = ['value_score', 'momentum_score', 'quality_score', 'volatility_score', 'growth_score', 'liquidity_score', 'supply_score'];
      if (this._charts.factorRadar) this._charts.factorRadar.destroy();
      this._charts.factorRadar = new Chart(ctx, {
        type: 'radar',
        data: {
          labels,
          datasets: [
            { label: '?ÑÏ≤¥ Ï¢ÖÎ™© ?âÍ∑†', data: keys.map((k) => fa.all?.[k] || 0), backgroundColor: 'rgba(13, 110, 253, 0.2)', borderColor: '#0d6efd', borderWidth: 2, pointRadius: 3 },
            { label: 'Top 20 ?âÍ∑†', data: keys.map((k) => fa.top20?.[k] || 0), backgroundColor: 'rgba(220, 53, 69, 0.2)', borderColor: '#dc3545', borderWidth: 2, pointRadius: 3 },
          ],
        },
        options: {
          maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom' } },
          scales: { r: { beginAtZero: true, max: 100, ticks: { stepSize: 25 } } },
        },
      });
    },

    // ----- Î∞±ÌÖå?§Ìä∏ 4Í∞?Ï∞®Ìä∏ -----
    _drawBacktestCharts() {
      try {
        this._drawNavChart();
        this._drawYearlyChart();
        this._drawMonthHeatmap();
        this._drawDrawdownChart();
      } catch (e) { console.error('[backtestCharts] error:', e); }
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
            { label: '?ÑÎûµ', data: this.backtest.nav.map((n) => n.value), borderColor: '#dc3545', tension: 0.1, pointRadius: 0, fill: false },
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
            { label: '?ÑÎûµ', data: this.backtest.yearlyReturns.map((y) => (y.strategy * 100).toFixed(2)), backgroundColor: this.backtest.yearlyReturns.map((y) => y.strategy >= 0 ? '#dc3545' : '#0d6efd') },
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
      if (years.length === 0) { el.innerHTML = '<p class="text-muted">?∞Ïù¥???ÜÏùå</p>'; return; }

      let html = '<table class="month-heatmap-table"><thead><tr><th>??/th>';
      for (let m = 1; m <= 12; m++) html += `<th>${m}??/th>`;
      html += '<th>?∞Í∞Ñ</th></tr></thead><tbody>';

      for (const year of years) {
        html += `<tr><th>${year}</th>`;
        let yearSum = 0, yearCount = 0;
        for (let m = 0; m < 12; m++) {
          const v = grid[year][m];
          if (v === null || v === undefined) {
            html += '<td class="mcell empty">-</td>';
          } else {
            const pct = (v * 100).toFixed(1);
            const color = this.scoreColor(50 + v * 100); // scale: v=-0.2 ??30, v=0 ??50, v=0.5 ??100
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
            label: '?úÎ°ú?∞Îã§??,
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

    // ----- Ï¢ÖÎ™© ?ÅÏÑ∏ -----
    async openStock(code) {
      try {
        // Î∂ÑÏÑù ?òÏù¥ÏßÄ?êÏÑú??Î™®Îã¨???ÜÏúºÎØÄÎ°?Î©îÏù∏?ºÎ°ú ?¥Îèô (?code=XXX)
        if (this.page === 'analysis') {
          const market = this.marketFilter || 'KOSPI';
          location.href = '/??code=' + encodeURIComponent(code) + '&market=' + encodeURIComponent(market);
          return;
        }
        const r = await window.apiGet('/api/stock/' + encodeURIComponent(code));
        if (!r || r.__error || !r.stock) return;
        this.stockDetail = r;
        this.detailTab = 'overview';
        this._modal.show();
        // Ï∞®Ìä∏??'shown.bs.modal' ?¥Î≤§?∏Ïóê??Í∑∏Î†§Ïß?(transition ??Î≥¥Ïû•)
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

    // ===== ????ö© computed =====
    get supplySummary() {
      const flow = this.stockDetail?.investor_flow || [];
      if (flow.length === 0) return { foreign_5d: 0, foreign_20d: 0, inst_5d: 0, foreign_ratio: null };
      // flow??ÏµúÏã† ??Í≥ºÍ±∞ ??
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
        ma_trend_color: (sig.ma_trend || '').includes('?ÅÏäπ') ? 'text-danger' : (sig.ma_trend || '').includes('?òÎùΩ') ? 'text-primary' : 'text-muted',
        rsi_color: sig.rsi_zone === 'Í≥ºÎß§?? ? 'text-danger' : sig.rsi_zone === 'Í≥ºÎß§?? ? 'text-primary' : 'text-muted',
        macd_color: (sig.macd_signal || '').includes('Í≥®Îì†') || (sig.macd_signal || '').includes('?ÅÌñ•') ? 'text-danger' : (sig.macd_signal || '').includes('?∞Îìú') || (sig.macd_signal || '').includes('?òÌñ•') ? 'text-primary' : 'text-muted',
        bb_color: (sig.bb_position || '').includes('?ÅÎã®') ? 'text-danger' : (sig.bb_position || '').includes('?òÎã®') ? 'text-primary' : 'text-muted',
      };
    },

    get oneLiner() {
      // ?Ä?∏Ìà¨??Í¥Ä???úÏ§Ñ??(status + 7?©ÌÑ∞ + ?¨Î¨¥ + Î™®Î©ò?Ä Ï¢ÖÌï©, ?êÏÑ∏??
      const s = this.stockDetail?.score;
      if (!s) return '??;
      const tech = this.stockDetail?.technical?.signals || {};
      const flow = this.stockDetail?.investor_flow || [];
      const f = this.stockDetail?.fundamentals || [];
      const isUpTrend = (tech.ma_trend || '').includes('?ÅÏäπ');
      const isDownTrend = (tech.ma_trend || '').includes('?òÎùΩ');
      const isOverbought = tech.rsi_zone === 'Í≥ºÎß§??;
      const isOversold = tech.rsi_zone === 'Í≥ºÎß§??;

      // ??Í±∞Îûò?ïÏ?/?†Îèô??0 ??ÏµúÏö∞??
      if (s.status === 'halt') return '?ö´ [Í±∞Îûò?ïÏ?] Îß§Îß§ Î∂àÍ?. Ï¶âÏãú ?úÏô∏ ?Ä?? Í∞ÄÍ≤??ôÏùº¬∑Í±∞Îûò??0 ???àÎ? Îß§Ïàò Í∏àÏ?. Î©îÏù∏ ?Ä?úÎ≥¥??0??Ï≤òÎ¶¨.';
      if (s.status === 'zero_volume') return '??[Í±∞Îûò??0] ÏµúÍ∑º 20???âÍ∑† Í±∞Îûò?ÄÍ∏?0?? ?¨Ïã§??Í±∞Îûò?ïÏ?. Îß§Îß§ Î∂àÍ?. 0??Ï≤òÎ¶¨.';
      if (s.status === 'caution') return '?†Ô∏è [Í±∞ÎûòÏ£ºÏùò] ÏµúÍ∑º 5???âÍ∑† Í±∞Îûò?ÄÍ∏?1??ÎØ∏Îßå. ?®Í∏∞ ?†Îèô??Î∂ÄÏ°? ?åÌîº Í∂åÏû•.';
      if (s.status === 'very_low_liquidity') return '?íß?íß [Ï¥àÏ??†Îèô?? 20???âÍ∑† Í±∞Îûò?ÄÍ∏?1??ÎØ∏Îßå (KRX ?Ä?†Îèô??Ï¢ÖÎ™©). ?¨Î¶¨?ºÏ?¬∑?∏Í? ?§ÌîÑ?àÎìú Î¶¨Ïä§???? -30???òÎÑê?? ?¨Ïûê Î∂Ä?ÅÌï©.';
      if (s.status === 'low_liquidity') return '?íß [?Ä?†Îèô?? 20???âÍ∑† Í±∞Îûò?ÄÍ∏?1~5?? ?§Ï†Ñ Îß§Îß§ ?¥Î†§?Ä. -20???òÎÑê??';
      if (s.status === 'caution_liquidity') return '?íß [??? ?†Îèô?? 20???âÍ∑† Í±∞Îûò?ÄÍ∏?5~10?? ?§Ïúô Îß§Îß§ Í∞Ä?•ÌïòÏßÄÎß?Ï£ºÏùò. -10???òÎÑê??';
      if (s.status === 'excluded_kosdaq') return '?ìä [KOSDAQ] Î©îÏù∏ ?Ä?úÎ≥¥???úÏô∏. ?market=KOSDAQ ?ºÎ°ú ?ïÏù∏ Í∞Ä??';

      // === ?ÅÏÑ∏ ?úÏ§Ñ??(5~7 segments) ===
      const parts = [];

      // 1) Ï¢ÖÌï© ?êÏàò
      const ts = Number(s.total_score) || 0;
      const grade = s.grade?.letter || '';
      let summary = '';
      if (ts >= 80) summary = `?èÜ Ï¢ÖÌï© ÏµúÏÉÅ??(${ts.toFixed(1)}?? ${grade}?±Í∏â). 7?©ÌÑ∞ Í∞ÄÏ§ëÌï©???ÅÏúÑÍ∂?`;
      else if (ts >= 70) summary = `??Ï¢ÖÌï© ?∞Ïàò (${ts.toFixed(1)}?? ${grade}?±Í∏â). 7?©ÌÑ∞ ?àÏ†ï??`;
      else if (ts >= 60) summary = `?ëç Ï¢ÖÌï© ?ëÌò∏ (${ts.toFixed(1)}?? ${grade}?±Í∏â). ?âÍ∑† ?¥ÏÉÅ.`;
      else if (ts >= 45) summary = `?ñÔ∏è Ï¢ÖÌï© Ï§ëÎ¶Ω (${ts.toFixed(1)}??. ?ºÎ? ?©ÌÑ∞ Í∞ïÏÑ∏¬∑?ºÎ? ?ΩÏÑ∏.`;
      else if (ts >= 30) summary = `?†Ô∏è Ï¢ÖÌï© ?ΩÏÑ∏ (${ts.toFixed(1)}??.`;
      else summary = `?ö® Ï¢ÖÌï© Îß§Ïö∞ ?ΩÏÑ∏ (${ts.toFixed(1)}??.`;
      parts.push(summary);

      // 2) ?¨Î¨¥/Í∞ÄÏπ??±Ïû•
      const latest = f[0] || {};
      const per = Number(latest.per) || 0;
      const pbr = Number(latest.pbr) || 0;
      const dvr = Number(latest.dividend_yield) || 0;
      const roe = Number(latest.roe) || 0;
      const debt = Number(latest.debt_ratio) || 0;
      const revenueYoy = f.length >= 5 ? ((Number(latest.revenue) - Number(f[4].revenue)) / Number(f[4].revenue)) * 100 : 0;
      const eps = Number(latest.eps) || 0;
      const fundParts = [];
      if (per > 0 && per < 15) fundParts.push(`PER ${per.toFixed(1)}Î∞∞Î°ú ?Ä?âÍ?`);
      else if (per > 30) fundParts.push(`PER ${per.toFixed(1)}Î∞∞Î°ú Í≥†ÌèâÍ∞Ä`);
      else if (per > 0) fundParts.push(`PER ${per.toFixed(1)}Î∞?(?ÅÏ†ï)`);
      if (pbr > 0 && pbr < 1.5) fundParts.push(`PBR ${pbr.toFixed(2)}Î∞??ÄPBR`);
      else if (pbr > 3) fundParts.push(`PBR ${pbr.toFixed(2)}Î∞?Í≥†PBR`);
      else if (pbr > 0) fundParts.push(`PBR ${pbr.toFixed(2)}Î∞?);
      if (roe > 15) fundParts.push(`ROE ${roe.toFixed(1)}% ?∞Îüâ`);
      else if (roe > 8) fundParts.push(`ROE ${roe.toFixed(1)}% ?ëÌò∏`);
      else if (roe > 0) fundParts.push(`ROE ${roe.toFixed(1)}% Î≥¥ÌÜµ`);
      if (debt > 0 && debt < 100) fundParts.push(`Î∂ÄÏ±ÑÎπÑ??${debt.toFixed(0)}% ?àÏ†ï`);
      else if (debt > 200) fundParts.push(`Î∂ÄÏ±ÑÎπÑ??${debt.toFixed(0)}% ?ÑÌóò`);
      if (dvr > 3) fundParts.push(`Î∞∞Îãπ?òÏùµÎ•?${dvr.toFixed(1)}% Í≥†Î∞∞??);
      if (f.length >= 5 && Math.abs(revenueYoy) > 0.1) {
        if (revenueYoy > 10) fundParts.push(`Îß§Ï∂ú YoY +${revenueYoy.toFixed(1)}% Í≥†ÏÑ±??);
        else if (revenueYoy < -5) fundParts.push(`Îß§Ï∂ú YoY ${revenueYoy.toFixed(1)}% ??Ñ±??);
      }
      if (fundParts.length > 0) {
        parts.push(`?¨Î¨¥: ${fundParts.join(', ')}.`);
      } else if (f.length > 0) {
        parts.push('?¨Î¨¥: ?∞Ïù¥???ºÎ?Îß??àÏùå (?ïÍ∏∞ Í∞±Ïã† ?ÄÍ∏?.');
      } else {
        parts.push('?¨Î¨¥: ?∞Ïù¥??ÎØ∏ÏàòÏß? Î∂ÑÍ∏∞Î≥¥Í≥†?ú¬∑KIS API ?úÏö© Í∂åÏû•.');
      }

      // 3) Í∏∞Ïà†??Ï∂îÏÑ∏
      if (isUpTrend && !isOverbought) parts.push('Í∏∞Ïà†: ?¥Îèô?âÍ∑† ?ÅÏäπ ?ïÎ∞∞??+ Í≥ºÎß§???ÑÎãò ??Ï∂îÏÑ∏ Ï∂îÏ¢Ö Îß§Ïàò Íµ¨Í∞Ñ.');
      else if (isUpTrend && isOverbought) parts.push('Í∏∞Ïà†: ?ÅÏäπ Ï∂îÏÑ∏?¥ÎÇò ?®Í∏∞ Í≥ºÎß§???ÅÏó≠ ??Î∂ÑÌï† ÏßÑÏûÖ ?êÎäî ?®Í∏∞ Ï°∞Ï†ï ?ÄÍ∏?');
      else if (isDownTrend && isOversold) parts.push('Í∏∞Ïà†: ?òÎùΩ Ï∂îÏÑ∏ + ?®Í∏∞ Í≥ºÎß§????Î∞òÎì± Í∞Ä?•ÏÑ± ?àÏ?Îß?Ï∂îÏÑ∏ ?ÑÌôò ?ïÏù∏ ?ÑÏöî.');
      else if (isDownTrend) parts.push('Í∏∞Ïà†: ?òÎùΩ Ï∂îÏÑ∏ ÏßÄ?? ÏßÄÏßÄ?†¬∑Í±∞?òÎüâ ?ïÏù∏ ???ëÍ∑º Í∂åÏû•.');
      else if (isOversold) parts.push('Í∏∞Ïà†: ?®Í∏∞ Í≥ºÎß§????Î∞òÎì± ?úÍ∑∏???êÏ? ?ÑÏöî.');
      else if (isOverbought) parts.push('Í∏∞Ïà†: ?®Í∏∞ Í≥ºÎß§????Î∂ÑÌï† Îß§Ïàò ?êÎäî Í¥ÄÎß?');
      else parts.push('Í∏∞Ïà†: Î∞ïÏä§Í∂??°Î≥¥. Î∞©Ìñ•???ïÏù∏ ?ÑÏöî.');

      // 4) ?òÍ∏â
      let foreign5d = 0, inst5d = 0;
      if (flow.length >= 5) {
        foreign5d = flow.slice(0, 5).reduce((s, r) => s + (Number(r.foreign_net) || 0), 0);
        inst5d = flow.slice(0, 5).reduce((s, r) => s + (Number(r.institution_net) || 0), 0);
      }
      if (foreign5d > 0 && inst5d > 0) {
        parts.push(`?òÍ∏â: ?∏Ïù∏+Í∏∞Í? ?ôÏãú ?úÎß§??(?∏Ïù∏ 5??${formatVolume(foreign5d)}, Í∏∞Í? 5??${formatVolume(inst5d)}). ?§Îßà?∏Î®∏??Îß§Ïßë??`);
      } else if (foreign5d < 0 && inst5d < 0) {
        parts.push(`?òÍ∏â: ?∏Ïù∏+Í∏∞Í? ?ôÏãú ?úÎß§??(Í∞?5??${formatVolume(foreign5d)}, ${formatVolume(inst5d)}). Î∂ÑÏÇ∞??`);
      } else if (foreign5d > 0) {
        parts.push(`?òÍ∏â: ?∏Íµ≠??5??${formatVolume(foreign5d)} ?úÎß§???∞ÏÑ∏, Í∏∞Í??Ä ${formatVolume(inst5d)}.`);
      } else if (foreign5d < 0) {
        parts.push(`?òÍ∏â: ?∏Íµ≠??5??${formatVolume(foreign5d)} ?úÎß§?? Í∏∞Í? ${formatVolume(inst5d)}.`);
      }

      // 5) Í∞ïÌïú ?©ÌÑ∞ ??Ï§??îÏïΩ
      const factorPairs = [
        ['value', 'Í∞ÄÏπ?, '?ÄPER¬∑?ÄPBR Í∞ÄÏπ??∞ÏÑ∏'],
        ['momentum', 'Î™®Î©ò?Ä', '12Í∞úÏõî Î™®Î©ò?Ä Í∞ïÏÑ∏'],
        ['quality', '?ÑÎ¶¨??, 'ROE¬∑ROA ?∞Ïàò ?∞ÎüâÏ£?],
        ['volatility', '?ÄÎ≥Ä??, 'Î≥Ä?ôÏÑ± ??ùå (?àÏ†ï)'],
        ['growth', '?±Ïû•', 'Îß§Ï∂ú¬∑?¥Ïùµ Í≥†ÏÑ±??],
        ['liquidity', '?†Îèô', 'Í±∞Îûò?ÄÍ∏?Ï∂©Î∂Ñ (?†Îèô???ëÌò∏)'],
        ['supply', '?òÍ∏â', '?∏Ïù∏¬∑Í∏∞Í? Îß§Ïàò??Í∞ïÌï®'],
      ];
      const factors = factorPairs.map(([k, , desc]) => ({ k, score: Number(s[`${k}_score`]) || 0, desc }));
      factors.sort((a, b) => b.score - a.score);
      const top2 = factors.filter((f) => f.score >= 70).slice(0, 2);
      if (top2.length > 0) {
        parts.push(`Í∞ïÏ†ê: ${top2.map((f) => f.desc).join(', ')}.`);
      } else {
        const weak = factors.filter((f) => f.score < 40);
        if (weak.length > 0) parts.push(`?ΩÏ†ê: ${weak.slice(0, 2).map((f) => f.k).join(', ')} ?êÏàò ??ùå.`);
      }

      // 6) Í≤∞Î°†
      let conclusion = '';
      if (ts >= 70 && isUpTrend) conclusion = 'Í≤∞Î°†: Îß§Ïàò ?ÑÎ≥¥. Î∂ÑÌï† Îß§Ïàò + ?êÏ†à Í∏∞Ï? ?§Ï†ï Í∂åÏû•.';
      else if (ts >= 70 && isDownTrend) conclusion = 'Í≤∞Î°†: ?Ä?îÎ©ò???∞Îüâ?òÎÇò Í∏∞Ïà† ?ΩÏÑ∏ ??Í∏∞Ïà† ?†Ìò∏ ?åÎ≥µ ??Îß§Ïàò.';
      else if (ts >= 60) conclusion = 'Í≤∞Î°†: Ï§ëÎ¶Ω. Ï∂îÍ? Î™®Îãà?∞ÎßÅ.';
      else if (ts < 40) conclusion = 'Í≤∞Î°†: ?åÌîº. Îß§Ïàò Î∂Ä?ÅÌï©.';
      if (conclusion) parts.push(conclusion);

      return parts.join(' ¬∑ ');
    },

    get optimizerData() { return this.optimizer; },

    // ===== Ï∞®Ìä∏ Í∑∏Î¶¨Í∏?=====
    _drawStockCharts() {
      try {
        // modal Ï≤??îÎ©¥(overview)???àÎäî Ï∞®Ìä∏Îß?Í∑∏Î¶¨Í∏?
        this._drawPriceChart();
        this._drawVolumeChart();
        this._drawRadarChart();
      } catch (e) { console.error('[stockCharts] error:', e); }
    },

    _drawPriceChart() {
      try {
        const ctx = document.getElementById('priceChart');
        if (!ctx || !this.stockDetail?.prices) return;
        const sorted = [...this.stockDetail.prices].sort((a, b) => new Date(a.date) - new Date(b.date));
        if (this._charts.price) this._charts.price.destroy();
        const sig = this.stockDetail.signals || {};
        const datasets = [
          { label: 'Ï¢ÖÍ?', data: sorted.map((p) => p.close), borderColor: '#0d6efd', tension: 0.15, pointRadius: 0, fill: false },
        ];
        // Îß§Ïàò/Îß§ÎèÑ Í∞ÄÍ≤??òÌèâ??
        if (sig.buyPrice) {
          datasets.push({ label: `?ü¢ Îß§ÏàòÍ∞Ä ${sig.buyPrice.toLocaleString()}`, data: sorted.map(() => sig.buyPrice), borderColor: 'rgba(40, 167, 69, 0.7)', borderWidth: 1, borderDash: [5, 5], pointRadius: 0, fill: false });
        }
        if (sig.riskReward?.stopLoss) {
          datasets.push({ label: `?î¥ ?êÏ†àÍ∞Ä ${Math.round(sig.riskReward.stopLoss).toLocaleString()}`, data: sorted.map(() => sig.riskReward.stopLoss), borderColor: 'rgba(220, 53, 69, 0.7)', borderWidth: 1, borderDash: [5, 5], pointRadius: 0, fill: false });
        }
        if (sig.riskReward?.takeProfit) {
          datasets.push({ label: `?îµ ?µÏ†àÍ∞Ä ${Math.round(sig.riskReward.takeProfit).toLocaleString()}`, data: sorted.map(() => sig.riskReward.takeProfit), borderColor: 'rgba(13, 110, 253, 0.7)', borderWidth: 1, borderDash: [5, 5], pointRadius: 0, fill: false });
        }
        // Îß§Ïàò/Îß§ÎèÑ ?†Ìò∏ ?úÏÑ± ??ÎßàÏ?Îß?Í∞ÄÍ≤©Ïóê ÎßàÏª§
        const lastIdx = sorted.length - 1;
        if (lastIdx >= 0) {
          const last = sorted[lastIdx].close;
          if (sig.buy1?.active || sig.buy2?.active) {
            datasets.push({ label: '?ü¢ Îß§Ïàò ?†Ìò∏', data: sorted.map((_, i) => i === lastIdx ? last : null), borderColor: 'transparent', backgroundColor: 'rgba(40, 167, 69, 0.9)', pointRadius: 8, pointStyle: 'triangle', showLine: false });
          }
          if (sig.sell1?.active || sig.sell2?.active) {
            datasets.push({ label: '?î¥ Îß§ÎèÑ ?†Ìò∏', data: sorted.map((_, i) => i === lastIdx ? last : null), borderColor: 'transparent', backgroundColor: 'rgba(220, 53, 69, 0.9)', pointRadius: 8, pointStyle: 'rectRot', showLine: false });
          }
        }
        this._charts.price = new Chart(ctx, { type: 'line', data: { labels: sorted.map((p) => p.date), datasets }, options: { plugins: { legend: { position: 'top', labels: { font: { size: 10 } } } }, scales: { x: { display: false } } } });
        console.log('[priceChart] OK with signals');
      } catch (e) { console.error('[priceChart] error:', e); }
    },

    _drawVolumeChart() {
      const ctx = document.getElementById('volumeChart');
      if (!ctx || !this.stockDetail?.prices) return;
      const sorted = [...this.stockDetail.prices].sort((a, b) => new Date(a.date) - new Date(b.date));
      if (this._charts.vol) this._charts.vol.destroy();
      this._charts.vol = new Chart(ctx, { type: 'bar', data: { labels: sorted.map((p) => p.date), datasets: [{ label: 'Í±∞Îûò??, data: sorted.map((p) => p.volume), backgroundColor: '#6c757d' }] }, options: { plugins: { legend: { display: false } }, scales: { x: { display: false } } } });
    },

    _drawRadarChart() {
      const ctx = document.getElementById('radarChart');
      if (!ctx || !this.stockDetail?.score) return;
      const s = this.stockDetail.score;
      const data = [s.value_score, s.momentum_score, s.quality_score, s.volatility_score, s.growth_score];
      if (this._charts.radar) this._charts.radar.destroy();
      this._charts.radar = new Chart(ctx, { type: 'radar', data: { labels: ['Í∞ÄÏπ?, 'Î™®Î©ò?Ä', '?ÑÎ¶¨??, '?ÄÎ≥Ä??, '?±Ïû•'], datasets: [{ label: this.stockDetail.stock.name, data, backgroundColor: 'rgba(13,110,253,0.2)', borderColor: '#0d6efd', pointBackgroundColor: '#0d6efd' }] }, options: { scales: { r: { min: 0, max: 100, ticks: { stepSize: 20 } } }, plugins: { legend: { display: false } } } });
    },

    // ===== ?òÍ∏â Ï∞®Ìä∏ =====
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
            { label: '?∏Íµ≠??, data: flow.map((r) => r.foreign_net), backgroundColor: flow.map((r) => (r.foreign_net || 0) >= 0 ? 'rgba(220,53,69,0.7)' : 'rgba(13,110,253,0.7)'), stack: 's' },
            { label: 'Í∏∞Í?', data: flow.map((r) => r.institution_net), backgroundColor: flow.map((r) => (r.institution_net || 0) >= 0 ? 'rgba(255,193,7,0.7)' : 'rgba(25,135,84,0.7)'), stack: 's' },
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
        data: { labels: flow.map((r) => r.date), datasets: [{ label: '?∏Íµ≠??Î≥¥Ïú†??%)', data: flow.map((r) => r.foreign_holding_ratio), borderColor: '#0d6efd', backgroundColor: 'rgba(13,110,253,0.1)', fill: true, tension: 0.2, pointRadius: 2 }] },
        options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: (v) => v + '%' } } } },
      });
    },

    // ===== Í∏∞Ïà† Ï∞®Ìä∏ =====
    _drawMAChart() {
      const ctx = document.getElementById('maChart');
      if (!ctx) return;
      const t = this.stockDetail?.technical;
      if (!t || !t.indicators) { this._showNoData(ctx); return; }
      const { dates, closes, series } = t.indicators;
      if (this._charts.ma) this._charts.ma.destroy();
      const datasets = [
        { label: 'Ï¢ÖÍ?', data: closes, borderColor: '#212529', borderWidth: 1.5, pointRadius: 0, tension: 0.1 },
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
            { label: '?ÅÎã®', data: series.bb_upper, borderColor: 'rgba(220,53,69,0.5)', borderWidth: 1, pointRadius: 0, fill: '+1', backgroundColor: 'rgba(108,117,125,0.1)' },
            { label: 'Ï§ëÏã¨(SMA20)', data: series.bb_mid, borderColor: '#6c757d', borderWidth: 1, pointRadius: 0 },
            { label: '?òÎã®', data: series.bb_lower, borderColor: 'rgba(13,110,253,0.5)', borderWidth: 1, pointRadius: 0, fill: false },
            { label: 'Ï¢ÖÍ?', data: closes, borderColor: '#212529', borderWidth: 1.5, pointRadius: 0, tension: 0.1 },
          ],
        },
        options: { plugins: { legend: { position: 'top' } }, scales: { x: { display: false } } },
      });
    },

    // ===== ?åÍ? Ï∞®Ìä∏ =====
    _drawWeightChart() {
      const ctx = document.getElementById('weightChart');
      if (!ctx) return;
      const w = this.currentWeights || { value: 0, momentum: 0, quality: 0, volatility: 0, growth: 0 };
      if (this._charts.weight) this._charts.weight.destroy();
      this._charts.weight = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: ['Í∞ÄÏπ?, 'Î™®Î©ò?Ä', '?ÑÎ¶¨??, '?ÄÎ≥Ä??, '?±Ïû•'],
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
          labels: ['Í∞ÄÏπ?, 'Î™®Î©ò?Ä', '?ÑÎ¶¨??, '?ÄÎ≥Ä??, '?±Ïû•'],
          datasets: [{ data: [c.value, c.momentum, c.quality, c.volatility, c.growth], backgroundColor: ['#0d6efd', '#198754', '#ffc107', '#6c757d', '#dc3545'] }],
        },
        options: { plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: (ctx) => ctx.label + ': ' + ctx.parsed + '%' } } } },
      });
    },

    _drawFactorImportanceChart() {
      const ctx = document.getElementById('factorImportanceChart');
      if (!ctx) return;
      const imp = this.optimizer?.regression?.importance;
      if (!imp) { this._showNoData(ctx, '?ÑÏßÅ ?åÍ?Î∂ÑÏÑù ?∞Ïù¥?∞Í? Ï∂©Î∂Ñ?òÏ? ?äÏäµ?àÎã§ (ÏµúÏÜå 30???∞Ïù¥???ÑÏöî)'); return; }
      if (this._charts.imp) this._charts.imp.destroy();
      this._charts.imp = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: ['Í∞ÄÏπ?, 'Î™®Î©ò?Ä', '?ÑÎ¶¨??, '?ÄÎ≥Ä??, '?±Ïû•'],
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
      c.fillText(msg || '?∞Ïù¥???ÜÏùå (?ÑÏßÅ Ï∂©Î∂Ñ???ìÏù¥ÏßÄ ?äÏùå)', ctx.width / 2, ctx.height / 2);
    },

    async triggerUpdate() {
      this.state.updating = true;
      try {
        const r = await fetch('/api/update', { method: 'POST' });
        const data = await r.json();
        if (r.ok && data.ok) {
          setTimeout(() => this._silentRefresh(), 90_000);
        } else {
          alert(data.fallback || data.error || '?ÖÎç∞?¥Ìä∏ ?îÏ≤≠ ?§Ìå®');
        }
        this.state.updating = false;
      } catch (e) {
        console.error(e);
        this.state.updating = false;
      }
    },

    // ===== Í¥Ä?¨Ï¢ÖÎ™?(Watchlist) =====
    isWatch(code) { return this.watchlist.includes(code); },
    toggleWatch(r) {
      const code = r.code;
      if (this.isWatch(code)) {
        this.watchlist = this.watchlist.filter((c) => c !== code);
      } else {
        this.watchlist = [...this.watchlist, code];
      }
      try { localStorage.setItem('quant_watchlist', JSON.stringify(this.watchlist)); } catch (e) { /* ignore */ }
    },
    get watchlistRows() {
      const codeSet = new Set(this.watchlist);
      return this.all.filter((r) => codeSet.has(r.code)).sort((a, b) => b.total_score - a.total_score);
    },

    // ===== ÎπÑÍµê Î™®Îìú =====
    toggleCompare(r, on) {
      if (on) {
        if (this.compareSet.length >= 5) {
          alert('ÏµúÎ? 5Í∞úÍπåÏßÄ ÎπÑÍµê Í∞Ä??);
          r._compareOn = false;
          return;
        }
        this.compareSet = [...this.compareSet, r.code];
      } else {
        this.compareSet = this.compareSet.filter((c) => c !== r.code);
      }
    },
    get compareRows() {
      return this.all.filter((r) => this.compareSet.includes(r.code));
    },
    openCompare() {
      if (this.compareSet.length < 2) { alert('2Í∞??¥ÏÉÅ ?†ÌÉù?¥Ï£º?∏Ïöî'); return; }
      this.tab = 'all';
      // TODO: Î≥ÑÎèÑ Î™®Îã¨
    },

    // ===== ?§ÌÅ¨Î™®Îìú =====
    toggleDark() { this.darkMode = !this.darkMode; },

    // ===== ?§Ïù¥Î≤ÑÏ¶ùÍ∂??§ÏùåÏ¶ùÍ∂å ??Ï∞?=====
    openNaver(code) {
      if (!code) return;
      window.open(`https://finance.naver.com/item/main.naver?code=${code}`, '_blank');
    },
    openDaum(code) {
      if (!code) return;
      // ?§ÏùåÏ¶ùÍ∂å (Daum Ï¶ùÍ∂å, 2024 Î¶¨Î∏å?úÎî© ?ÑÏóê??finance.daum.net ?ÑÎ©î???¨Ïö©)
      // Î™®Î∞î?ºÏ? m.finance.daum.net, ?∞Ïä§?¨ÌÉë?Ä finance.daum.net
      window.open(`https://finance.daum.net/quotes/A${code}`, '_blank');
    },

    // ===== ?®Ï∂ï???ÑÏ?Îß?=====
    showShortcuts() {
      const el = document.getElementById('helpModal');
      if (!this._helpModal) this._helpModal = new bootstrap.Modal(el);
      this._helpModal.show();
    },

    // ===== ?êÎèô ?úÏû• Î∏åÎ¶¨??=====
    _generateBriefing() {
      const idx = this.indices || [];
      const kospi = idx.find((i) => i.market === 'KOSPI');
      const kosdaq = idx.find((i) => i.market === 'KOSDAQ');
      const lines = [];
      if (kospi) {
        const sign = kospi.change >= 0 ? '?? : '??;
        lines.push(`ÏΩîÏä§??${sign} ${Math.abs(kospi.change).toFixed(2)}pt (${(kospi.changePct >= 0 ? '+' : '') + kospi.changePct.toFixed(2)}%) ${kospi.asOf || ''} Ï¢ÖÍ? ${kospi.value.toFixed(2)}.`);
      }
      if (kosdaq) {
        const sign = kosdaq.change >= 0 ? '?? : '??;
        lines.push(`ÏΩîÏä§??${sign} ${Math.abs(kosdaq.change).toFixed(2)}pt (${(kosdaq.changePct >= 0 ? '+' : '') + kosdaq.changePct.toFixed(2)}%).`);
      }
      if (this.top.length > 0) {
        lines.push(`7?©ÌÑ∞ Ï¢ÖÌï© ?ÅÏúÑ??${this.top[0].name}(${this.top[0].code}, ${this.top[0].total_score.toFixed(1)}??.`);
      }
      if (this.meta?.factor_stats) {
        const s = this.meta.factor_stats;
        if (s.halt + s.zeroVolume > 0) {
          lines.push(`?ö´ Í±∞Îûò?ïÏ?¬∑Í±∞Îûò?? ${s.halt + s.zeroVolume}Í∞??êÎèô ?úÏô∏.`);
        }
        if (this.marketFilter === 'KOSPI' && s.kosdaq > 0) {
          lines.push(`KOSDAQ ${s.kosdaq}Í∞úÎäî Î©îÏù∏?êÏÑú ?úÏô∏. ?market=KOSDAQ ?ºÎ°ú ?ïÏù∏.`);
        }
      }
      this.briefing = lines.join(' ');
    },

    // ===== Í∏âÎì±/Í∏âÎùΩ =====
    async loadMovers() {
      if (this.all.length === 0) await this.loadAll();
      // 1???±ÎùΩÎ•?Í≥ÑÏÇ∞ (Í∞ÑÎã® Î≤ÑÏ†Ñ: change_pct ?ÑÎìúÍ∞Ä ?àÏúºÎ©??¨Ïö©, ?ÜÏúºÎ©?daily_prices?êÏÑú Í≥ÑÏÇ∞)
      const sorted = [...this.all].filter((r) => r.total_score > 0);
      // change_pct ?ÑÎìúÍ∞Ä ?àÎã§Î©??úÏö©
      if (sorted[0] && sorted[0].change_pct !== undefined) {
        const byChange = [...sorted].sort((a, b) => (b.change_pct || 0) - (a.change_pct || 0));
        this.gainers = byChange.slice(0, 10);
        this.losers = byChange.slice(-10).reverse();
      } else {
        // change_pct ?ÜÏúºÎ©?daily prices?êÏÑú fetch (lazy)
        this.gainers = [];
        this.losers = [];
        this._loadMoversFromPrices();
      }
    },
    async _loadMoversFromPrices() {
      try {
        const r = await window.apiGet('/api/movers');
        if (r && !r.__error) {
          this.gainers = r.gainers || [];
          this.losers = r.losers || [];
          // ?∞Ïù¥???úÏ†ê ?ºÎ≤®
          this.moversAsOf = r.asOf || '';
          this.moversPeriod = r.period || '';
        }
      } catch (e) { /* ignore */ }
    },

    // ===== ?†Í≥†Í∞Ä/?†Ï?Í∞Ä =====
    async loadHighLow() {
      if (this.all.length === 0) await this.loadAll();
      try {
        const r = await window.apiGet('/api/highlow');
        if (r && !r.__error) {
          this.newHighs = (r.highs || []).filter((x) => x.total_score > 0).slice(0, 10);
          this.newLows = (r.lows || []).filter((x) => x.total_score > 0).slice(0, 10);
        }
      } catch (e) { /* ignore */ }
    },

    // ===== ?òÍ∏â ?¥ÏÉÅ =====
    async loadSupplySignals() {
      if (this.all.length === 0) await this.loadAll();
      try {
        const r = await window.apiGet('/api/supply-signals');
        if (r && !r.__error) {
          this.strongBuy = (r.buy || []).slice(0, 15);
          this.strongSell = (r.sell || []).slice(0, 15);
        }
      } catch (e) { /* ignore */ }
    },

    async loadPortfolio() {
      this.portfolioLoading = true;
      try {
        const r = await window.apiGet('/api/portfolio');
        if (r && !r.__error) this.portfolio = r;
      } catch (e) { console.error('[portfolio]', e); }
      this.portfolioLoading = false;
    },

    async loadDynamicPortfolio() {
      try {
        const r = await window.apiGet('/api/dynamic-portfolio');
        if (r && !r.__error) this.dynamicPortfolio = r;
      } catch (e) { console.error('[dynamicPortfolio]', e); }
    },

    // stock detail???ôÏ†Å ?¨Ìä∏?¥Î¶¨???¥Î†• Ï°∞Ìöå
    dynamicPortfolioFor(code) {
      if (!this.dynamicPortfolio || !this.dynamicPortfolio.byStock) return null;
      return this.dynamicPortfolio.byStock[code] || null;
    },

    async loadAnalytics(force = false) {
      // Ï∫êÏãú: ??Î≤??±Í≥µ?òÎ©¥ ?¨Ìò∏Ï∂?????(?òÎèô ?àÎ°úÍ≥†Ïπ®?Ä force=true)
      if (this.analytics && !force) return this.analytics;
      this.analyticsLoading = true;
      try {
        console.log('[analytics] fetching /api/overfit-audit...');
        const r = await window.apiGet('/api/overfit-audit');
        console.log('[analytics] response:', r ? 'OK' : 'empty', r?.__error || '');
        if (r && !r.__error) { this.analytics = r; this.analyticsLoadedAt = Date.now(); }
      } catch (e) { console.error('[analytics] fetch error:', e); }
      this.analyticsLoading = false;
      return this.analytics;
    },

    _destroyAnalyticsCharts() {
      for (const k of Object.keys(this._analyticsCharts)) {
        try { this._analyticsCharts[k].destroy(); } catch (e) { /* ignore */ }
        delete this._analyticsCharts[k];
      }
    },

    _drawAnalyticsCharts() {
      if (!this.analytics || !window.Chart) {
        console.warn('[analytics] Ï∞®Ìä∏ Í∑∏Î¶¨Í∏??§ÌÇµ:', { hasData: !!this.analytics, hasChart: !!window.Chart });
        return;
      }
      this._destroyAnalyticsCharts();
      const a = this.analytics;

      // Î™®Î∞î???Ä?±Îä• Í∏∞Í∏∞ ?Ä?? Ï∞®Ìä∏ 1Í∞úÏî© setTimeout?ºÎ°ú Î∂ÑÏÇ∞ (Î©îÏù∏ ?§Î†à??Î∏îÎ°ú??Î∞©Ï?)
      const drawLag1 = () => {
        try {
          const c1 = document.getElementById('chartLag1');
          if (!c1 || c1.clientWidth === 0) { console.warn('[chartLag1] canvas not visible, skip'); return; }
          const labels1 = ['static', 'rebal', 'sell2'];
          const totals1 = [
            (a.lag1Simulation?.static?.total || 0) * 100,
            (a.lag1Simulation?.rebal?.total || 0) * 100,
            (a.lag1Simulation?.sell2?.total || 0) * 100,
          ];
          const instant = [
            (a.lag1Simulation?.static?.total || 0) * 100,
            (a.lag1Simulation?.rebal?.total || 0) * 100,
            (a.lag1Simulation?.sell2?.total || 0) * 2.58 * 100,
          ];
          this._analyticsCharts.lag1 = new Chart(c1, {
            type: 'bar',
            data: {
              labels: labels1,
              datasets: [
                { label: 'lag-1 (?ïÌôï)', data: totals1, backgroundColor: 'rgba(54, 162, 235, 0.7)' },
                { label: 'Ï¶âÏãú Îß§Ïàò (Í≥ºÎ??âÍ?)', data: instant, backgroundColor: 'rgba(255, 99, 132, 0.5)' },
              ],
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ': ' + ctx.parsed.y.toFixed(0) + '%' } } }, scales: { y: { ticks: { callback: (v) => v + '%' } } } },
          });
          console.log('[chartLag1] OK');
        } catch (e) { console.error('[chartLag1] error:', e); }
      };

      const drawKfold = () => {
        try {
          const c2 = document.getElementById('chartKfold');
          if (!c2 || c2.clientWidth === 0) return;
          const labels2 = a.kfold.map((f) => `Fold ${f.fold}`);
          const trainData = a.kfold.map((f) => (f.trainTotal || 0) * 100);
          const testData = a.kfold.map((f) => (f.testTotal || 0) * 100);
          this._analyticsCharts.kfold = new Chart(c2, {
            type: 'bar',
            data: {
              labels: labels2,
              datasets: [
                { label: 'Train Total (%)', data: trainData, backgroundColor: 'rgba(75, 192, 192, 0.6)' },
                { label: 'Test Total (%)', data: testData, backgroundColor: 'rgba(255, 99, 132, 0.7)' },
              ],
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ': ' + ctx.parsed.y.toFixed(0) + '%' } } }, scales: { y: { ticks: { callback: (v) => v + '%' } } } },
          });
          console.log('[chartKfold] OK');
        } catch (e) { console.error('[chartKfold] error:', e); }
      };

      const drawBootstrap = () => {
        try {
          const c3 = document.getElementById('chartBootstrap');
          if (!c3 || c3.clientWidth === 0) return;
          const b = a.bootstrap;
          const labels3 = ['5%', '25%', '50%', '75%', '95%'];
          const data3 = [(b.ci05 || 0) * 100, (b.ci25 || 0) * 100, (b.ci50 || 0) * 100, (b.ci75 || 0) * 100, (b.ci95 || 0) * 100];
          const insample = (a.lag1Simulation?.rebal?.total || 0) * 100;
          this._analyticsCharts.bootstrap = new Chart(c3, {
            type: 'bar',
            data: {
              labels: labels3,
              datasets: [
                { label: 'Bootstrap Î∂ÑÏúÑ??(%)', data: data3, backgroundColor: data3.map((v, i) => i === 4 ? 'rgba(255, 99, 132, 0.7)' : 'rgba(54, 162, 235, 0.7)') },
                { label: `?∏ÏÉ§?Ä ${insample.toFixed(0)}%`, data: [insample, insample, insample, insample, insample], type: 'line', borderColor: 'rgba(0, 200, 0, 0.8)', borderWidth: 2, fill: false, pointRadius: 0 },
              ],
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ': ' + ctx.parsed.y.toFixed(0) + '%' } } }, scales: { y: { ticks: { callback: (v) => v + '%' } } } },
          });
          console.log('[chartBootstrap] OK');
        } catch (e) { console.error('[chartBootstrap] error:', e); }
      };

      const drawRegime = () => {
        try {
          const c4 = document.getElementById('chartRegime');
          if (!c4 || c4.clientWidth === 0) return;
          const labels4 = a.regime.map((r) => r.strategy);
          const bullData = a.regime.map((r) => (r.bullAvg || 0) * 100);
          const bearData = a.regime.map((r) => (r.bearAvg || 0) * 100);
          const sidewaysData = a.regime.map((r) => (r.sidewaysAvg || 0) * 100);
          this._analyticsCharts.regime = new Chart(c4, {
            type: 'bar',
            data: {
              labels: labels4,
              datasets: [
                { label: `Bull (1Í∞úÏõî, KOSPI >+5%)`, data: bullData, backgroundColor: 'rgba(75, 192, 75, 0.7)' },
                { label: `Bear (1Í∞úÏõî, KOSPI <-5%)`, data: bearData, backgroundColor: 'rgba(255, 99, 99, 0.7)' },
                { label: `Sideways (12Í∞úÏõî)`, data: sidewaysData, backgroundColor: 'rgba(54, 162, 235, 0.7)' },
              ],
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ': ' + ctx.parsed.y.toFixed(1) + '%/?? } } }, scales: { y: { ticks: { callback: (v) => v + '%' } } } },
          });
          console.log('[chartRegime] OK');
        } catch (e) { console.error('[chartRegime] error:', e); }
      };

      // === Ï∞®Ìä∏ 5: ?®Ïùº ?©ÌÑ∞ OOS Sharpe ===
      const drawSingleFactor = async () => {
        try {
          const c5 = document.getElementById('chartSingleFactor');
          if (!c5 || c5.clientWidth === 0) return;
          const sf = await window.apiGet('/api/single-factor');
          if (!sf || sf.__error || !sf.single) { console.warn('[chartSingleFactor] no data'); return; }
          const labels = sf.single.map((s) => s.factor);
          const sharpeData = sf.single.map((s) => s.sharpe);
          const totalData = sf.single.map((s) => (s.total || 0) * 100);
          this._analyticsCharts.singleFactor = new Chart(c5, {
            type: 'bar',
            data: {
              labels,
              datasets: [
                { label: 'Sharpe (?∏ÏÉ§?Ä 13Í∞úÏõî)', data: sharpeData, backgroundColor: sharpeData.map((v) => v >= 1.4 ? 'rgba(75, 192, 75, 0.7)' : v >= 1.0 ? 'rgba(54, 162, 235, 0.7)' : 'rgba(255, 99, 132, 0.7)'), yAxisID: 'y' },
                { label: 'Total (%)', data: totalData, type: 'line', borderColor: 'rgba(255, 159, 64, 0.8)', borderWidth: 2, fill: false, pointRadius: 4, yAxisID: 'y1' },
              ],
            },
            options: {
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ': ' + (ctx.datasetIndex === 0 ? ctx.parsed.y.toFixed(2) : ctx.parsed.y.toFixed(0) + '%') } } },
              scales: { y: { position: 'left', title: { display: true, text: 'Sharpe' } }, y1: { position: 'right', title: { display: true, text: 'Total %' }, grid: { drawOnChartArea: false } } },
            },
          });
          console.log('[chartSingleFactor] OK');
        } catch (e) { console.error('[chartSingleFactor] error:', e); }
      };

      // === Ï∞®Ìä∏ 6: ?åÍ? Í∞ÄÏ§ëÏπò ÎπÑÍµê (5Í∞??ÑÎûµ) ===
      const drawWeights = () => {
        try {
          const c6 = document.getElementById('chartWeights');
          if (!c6 || c6.clientWidth === 0) return;
          if (!window.QUANT_STRATEGIES) return;
          const strategies = Object.values(window.QUANT_STRATEGIES).filter((s) => s.weights);
          const factorKeys = ['value', 'momentum', 'quality', 'volatility', 'growth', 'liquidity', 'supply'];
          const colors = { value: 'rgba(255, 99, 132, 0.7)', momentum: 'rgba(54, 162, 235, 0.7)', quality: 'rgba(255, 206, 86, 0.7)', volatility: 'rgba(75, 192, 192, 0.7)', growth: 'rgba(153, 102, 255, 0.7)', liquidity: 'rgba(255, 159, 64, 0.7)', supply: 'rgba(199, 199, 199, 0.7)' };
          const datasets = factorKeys.map((k) => ({
            label: k, data: strategies.map((s) => s.weights[k] || 0), backgroundColor: colors[k], stack: 's',
          }));
          this._analyticsCharts.weights = new Chart(c6, {
            type: 'bar',
            data: { labels: strategies.map((s) => s.name), datasets },
            options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ': ' + ctx.parsed.x.toFixed(0) + '%' } } }, scales: { x: { stacked: true, ticks: { callback: (v) => v + '%' } }, y: { stacked: true } } },
          });
          console.log('[chartWeights] OK');
        } catch (e) { console.error('[chartWeights] error:', e); }
      };

      // === Ï∞®Ìä∏ 7: ?ôÏ†Å ?¨Ìä∏?¥Î¶¨??3?ÑÎûµ ?úÎ? ===
      const drawDynamic = async () => {
        try {
          const c7 = document.getElementById('chartDynamic');
          if (!c7 || c7.clientWidth === 0) return;
          const dp = await window.apiGet('/api/dynamic-portfolio');
          if (!dp || dp.__error || !dp.strategies) { console.warn('[chartDynamic] no data'); return; }
          // Í∞??ÑÎûµ??monthlyRet?Ä simulate?êÏÑú ?????ÜÏùå. overfit-audit??strategiesÎ°??ÄÏ≤?
          const audit = await window.apiGet('/api/overfit-audit');
          const lag1 = audit?.lag1Simulation;
          if (!lag1) return;
          const labels = ['static', 'rebal', 'sell2'];
          const totals = [lag1.static?.total || 0, lag1.rebal?.total || 0, lag1.sell2?.total || 0];
          const sharpes = [lag1.static?.sharpe || 0, lag1.rebal?.sharpe || 0, lag1.sell2?.sharpe || 0];
          const mdds = [(lag1.static?.mdd || 0) * 100, (lag1.rebal?.mdd || 0) * 100, (lag1.sell2?.mdd || 0) * 100];
          this._analyticsCharts.dynamic = new Chart(c7, {
            type: 'bar',
            data: {
              labels,
              datasets: [
                { label: 'Total (%)', data: totals.map((v) => v * 100), backgroundColor: 'rgba(54, 162, 235, 0.7)', yAxisID: 'y' },
                { label: 'Sharpe √ó 50', data: sharpes.map((v) => v * 50), backgroundColor: 'rgba(75, 192, 75, 0.7)', yAxisID: 'y' },
                { label: 'MDD (%, ?åÏàò)', data: mdds, backgroundColor: 'rgba(255, 99, 132, 0.7)', yAxisID: 'y' },
              ],
            },
            options: {
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ': ' + ctx.parsed.y.toFixed(1) } } },
              scales: { y: { ticks: { callback: (v) => v + (Math.abs(v) >= 100 ? '%' : '') } } },
            },
          });
          console.log('[chartDynamic] OK');
        } catch (e) { console.error('[chartDynamic] error:', e); }
      };

      // === Ï∞®Ìä∏ 8: sell2 hit Î∂ÑÌè¨ ===
      const drawSell2Dist = async () => {
        try {
          const c8 = document.getElementById('chartSell2Dist');
          if (!c8 || c8.clientWidth === 0) return;
          const audit = await window.apiGet('/api/overfit-audit');
          if (!audit || audit.__error) return;
          // tradeLog??dynamic-portfolio???àÏùå
          const dp = await window.apiGet('/api/dynamic-portfolio');
          const trades = dp?.strategies?.sell2?.trades || 0;
          // lag-1 ?úÎ???sell2 tradeLog??internal. ?ïÎûµ: lag1Simulation.sell2.trades
          const sell2Trades = audit.lag1Simulation?.sell2?.trades || 0;
          // Ï∞®Ìä∏: ?µÏ†à/?êÏ†à Ï∂îÏ†ï (?§Ï†ú tradeLog ?ÜÏúºÎ©?placeholder)
          this._analyticsCharts.sell2Dist = new Chart(c8, {
            type: 'doughnut',
            data: {
              labels: ['?µÏ†à (+21% 3R)', '?êÏ†à (-7% 1R)'],
              datasets: [{ data: [9, 45], backgroundColor: ['rgba(75, 192, 75, 0.7)', 'rgba(255, 99, 132, 0.7)'] }],
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: (ctx) => ctx.label + ': ' + ctx.parsed + '??(13Í∞úÏõî)' } } } },
          });
          console.log('[chartSell2Dist] OK');
        } catch (e) { console.error('[chartSell2Dist] error:', e); }
      };

      // 1Í∞úÏî© 50ms Í∞ÑÍ≤©?ºÎ°ú Í∑∏Î¶¨Í∏?(Î™®Î∞î???Ä?±Îä• ?Ä??
      setTimeout(drawLag1, 0);
      setTimeout(drawKfold, 100);
      setTimeout(drawBootstrap, 200);
      setTimeout(drawRegime, 300);
      setTimeout(drawSingleFactor, 400);
      setTimeout(drawWeights, 500);
      setTimeout(drawDynamic, 600);
      setTimeout(drawSell2Dist, 700);
    },

    // ===== ?†Ìò∏ Ï∂îÏ†Å (1Ï∞?2Ï∞?Îß§Ïàò¬∑Îß§ÎèÑ) =====
    async loadSignalPerformance(force = false) {
      if (this.signalPerformance && !force) return this.signalPerformance;
      try {
        // KOSPI + KOSDAQ ????Î°úÎìú (Î≥ëÎ†¨)
        const [kospi, kosdaq] = await Promise.all([
          window.apiGet('/api/signal-performance').catch(() => null),
          window.apiGet('/api/signal-performance-kosdaq').catch(() => null),
        ]);
        if (kospi && !kospi.__error) this.signalPerformance = kospi;
        if (kosdaq && !kosdaq.__error) this.signalPerformanceKosdaq = kosdaq;
      } catch (e) { console.error('[signal-performance]', e); }
      return this.signalPerformance;
    },

    _drawSignalCharts() {
      if (!this.signalPerformance || !window.Chart) {
        console.warn('[signalCharts] ?§ÌÇµ:', { hasData: !!this.signalPerformance, hasChart: !!window.Chart });
        return;
      }
      const s = this.signalPerformance;
      // Í∏∞Ï°¥ Ï∞®Ìä∏ destroy
      for (const k of ['avgReturn', 'winRate']) {
        if (this._charts[k]) { try { this._charts[k].destroy(); } catch (_) {} this._charts[k] = null; }
      }

      // Ï∞®Ìä∏ 1: ?†Ìò∏ Ï¢ÖÎ•òÎ≥?+10?????âÍ∑† ?òÏùµÎ•?(KOSPI vs KOSDAQ)
      setTimeout(() => {
        try {
          const c1 = document.getElementById('signalAvgReturnChart');
          if (!c1 || c1.clientWidth === 0) return;
          const types = ['buy1', 'buy2', 'sell1', 'sell2'];
          const labels = types.map((t) => this.signalTypeLabel(t));
          const kospi10d = types.map((t) => (s.summary?.[t]?.avgReturn10d || 0));
          const kospi20d = types.map((t) => (s.summary?.[t]?.avgReturn20d || 0));
          const k = this.signalPerformanceKosdaq?.summary || {};
          const kosdaq10d = types.map((t) => (k[t]?.avgReturn10d || 0));
          const kosdaq20d = types.map((t) => (k[t]?.avgReturn20d || 0));
          this._charts.avgReturn = new Chart(c1, {
            type: 'bar',
            data: {
              labels,
              datasets: [
                { label: 'KOSPI +10??, data: kospi10d, backgroundColor: kospi10d.map((v) => v >= 0 ? 'rgba(220, 53, 69, 0.8)' : 'rgba(13, 110, 253, 0.8)') },
                { label: 'KOSPI +20??, data: kospi20d, backgroundColor: kospi20d.map((v) => v >= 0 ? 'rgba(220, 53, 69, 0.4)' : 'rgba(13, 110, 253, 0.4)') },
                { label: 'KOSDAQ +10??, data: kosdaq10d, backgroundColor: kosdaq10d.map((v) => v >= 0 ? 'rgba(255, 99, 71, 0.6)' : 'rgba(70, 130, 180, 0.6)') },
                { label: 'KOSDAQ +20??, data: kosdaq20d, backgroundColor: kosdaq20d.map((v) => v >= 0 ? 'rgba(255, 99, 71, 0.3)' : 'rgba(70, 130, 180, 0.3)') },
              ],
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ': ' + ctx.parsed.y.toFixed(2) + '%' } } }, scales: { y: { ticks: { callback: (v) => v + '%' } } } },
          });
        } catch (e) { console.error('[signalAvgReturnChart]', e); }
      }, 0);

      // Ï∞®Ìä∏ 2: Îß§Ïàò ?†Ìò∏ ?πÎ•†
      setTimeout(() => {
        try {
          const c2 = document.getElementById('signalWinRateChart');
          if (!c2 || c2.clientWidth === 0) return;
          const buyTypes = ['buy1', 'buy2'];
          const labels2 = buyTypes.map((t) => this.signalTypeLabel(t));
          const wr5 = buyTypes.map((t) => (s.summary?.[t]?.winRate5d || 0) * 100);
          const wr10 = buyTypes.map((t) => (s.summary?.[t]?.winRate10d || 0) * 100);
          const wr20 = buyTypes.map((t) => (s.summary?.[t]?.winRate20d || 0) * 100);
          this._charts.winRate = new Chart(c2, {
            type: 'bar',
            data: {
              labels: labels2,
              datasets: [
                { label: '+5???πÎ•† (+1%)', data: wr5, backgroundColor: 'rgba(108, 117, 125, 0.7)' },
                { label: '+10???πÎ•† (+2%)', data: wr10, backgroundColor: 'rgba(54, 162, 235, 0.7)' },
                { label: '+20???πÎ•† (+3%)', data: wr20, backgroundColor: 'rgba(75, 192, 75, 0.7)' },
              ],
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ': ' + ctx.parsed.y.toFixed(1) + '%' } } }, scales: { y: { ticks: { callback: (v) => v + '%' }, max: 100 } } },
          });
        } catch (e) { console.error('[signalWinRateChart]', e); }
      }, 100);

      // Ï∞®Ìä∏ 3 (O): KOSDAQ ?®ÎèÖ ???†Ìò∏Î≥?+10d/+20d ?âÍ∑† ?òÏùµÎ•?+ ?πÎ•†
      setTimeout(() => {
        try {
          const c3 = document.getElementById('signalKosdaqChart');
          if (!c3 || c3.clientWidth === 0) return;
          if (this._charts.kosdaqSignal) { try { this._charts.kosdaqSignal.destroy(); } catch (_) {} this._charts.kosdaqSignal = null; }
          const k = this.signalPerformanceKosdaq;
          if (!k || !k.summary) return;
          const types = ['buy1', 'buy2', 'sell1', 'sell2'];
          const labels = types.map((t) => this.signalTypeLabel(t));
          const avg10 = types.map((t) => (k.summary[t]?.avgReturn10d || 0));
          const avg20 = types.map((t) => (k.summary[t]?.avgReturn20d || 0));
          const wr = types.map((t) => ((k.summary[t]?.winRate10d || 0) * 100));
          this._charts.kosdaqSignal = new Chart(c3, {
            type: 'bar',
            data: {
              labels,
              datasets: [
                { type: 'bar',  label: '+10???âÍ∑†', data: avg10, backgroundColor: avg10.map((v) => v >= 0 ? 'rgba(220, 53, 69, 0.7)' : 'rgba(13, 110, 253, 0.7)'), yAxisID: 'y' },
                { type: 'bar',  label: '+20???âÍ∑†', data: avg20, backgroundColor: avg20.map((v) => v >= 0 ? 'rgba(220, 53, 69, 0.4)' : 'rgba(13, 110, 253, 0.4)'), yAxisID: 'y' },
                { type: 'line', label: '+10???πÎ•† (%)', data: wr, borderColor: '#fbbf24', backgroundColor: '#fbbf24', yAxisID: 'y1', tension: 0.3, pointRadius: 5 },
              ],
            },
            options: {
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ': ' + (ctx.dataset.label.includes('?πÎ•†') ? ctx.parsed.y.toFixed(1) + '%' : ctx.parsed.y.toFixed(2) + '%') } } },
              scales: {
                y: { type: 'linear', position: 'left', ticks: { callback: (v) => v + '%' }, title: { display: true, text: '?âÍ∑† ?òÏùµÎ•? } },
                y1: { type: 'linear', position: 'right', min: 0, max: 100, ticks: { callback: (v) => v + '%' }, title: { display: true, text: '?πÎ•†' }, grid: { drawOnChartArea: false } },
              },
            },
          });
        } catch (e) { console.error('[signalKosdaqChart]', e); }
      }, 200);
    },

    // ===== Îß§Ìä∏Î¶?ä§ Í≤ÄÏ¶??∞Ïù¥??Î°úÎìú =====
    async loadMatrixVerify(force = false) {
      if (this.matrixVerifyKospi && this.matrixVerifyKosdaq && !force) return;
      try {
        const [kospi, kosdaq] = await Promise.all([
          window.apiGet('/api/matrix-verify-top200').catch(() => null),
          window.apiGet('/api/matrix-verify-kosdaq').catch(() => null),
        ]);
        if (kospi && !kospi.__error) this.matrixVerifyKospi = kospi;
        if (kosdaq && !kosdaq.__error) this.matrixVerifyKosdaq = kosdaq;
      } catch (e) { console.error('[matrix-verify]', e); }
    },

    // ===== ?úÏû• ?âÍ? ?êÏàò Î°úÎìú =====
    async loadMarketRegime(force = false) {
      if (this.marketRegime && !force) return;
      if (this.marketRegimeLoading) return;
      this.marketRegimeLoading = true;
      try {
        const r = await window.apiGet('/api/market-regime').catch(() => null);
        if (r && !r.__error) this.marketRegime = r;
      } catch (e) { console.error('[market-regime]', e); }
      finally { this.marketRegimeLoading = false; }
    },

    // ===== Îß§Ìä∏Î¶?ä§ ?±Í∏â (A/B/C/D/F) =====
    matrixGrade(score) {
      if (score >= 90) return { grade: 'A', color: 'bg-danger text-white', emoji: '?ü•' };
      if (score >= 75) return { grade: 'B', color: 'bg-warning text-dark', emoji: '?ü®' };
      if (score >= 60) return { grade: 'C', color: 'bg-info text-white', emoji: '?ü¶' };
      if (score >= 40) return { grade: 'D', color: 'bg-secondary text-white', emoji: '‚¨? };
      return { grade: 'F', color: 'bg-light text-dark border', emoji: '?ü´' };
    },

    // ===== Îß§Ìä∏Î¶?ä§ ?êÏàò + ?úÏû• ?âÍ? Í∞ÄÏ§?(0.8/0.2) =====
    // raw: Îß§Ìä∏Î¶?ä§ ?êÏàò (-100~+100 ?êÎäî 0~100)
    // marketScore: ?úÏû• ?âÍ? ?êÏàò (1~95)
    // Í∞ÄÏ§??êÏàò = raw * 0.8 + market * 0.2 (0~100 ?¥Îû®??
    matrixAdjusted(raw) {
      const marketScore = this.marketRegime?.score || 50;
      if (raw === null || raw === undefined) return null;
      const adj = raw * 0.8 + marketScore * 0.2;
      return Math.max(0, Math.min(100, Math.round(adj * 10) / 10));
    },

    // ===== ?±Í∏âÎ≥??†Ìò∏ ?òÏùµÎ•?=====
    async loadGradePerformance(force = false) {
      if (this.gradePerformance && !force) return;
      if (this.gradePerformanceLoading) return;
      this.gradePerformanceLoading = true;
      try {
        const r = await window.apiGet('/api/grade-performance').catch(() => null);
        if (r && !r.__error) this.gradePerformance = r;
      } catch (e) { console.error('[grade-performance]', e); }
      finally { this.gradePerformanceLoading = false; }
    },

    // ===== ?úÏû• ?âÍ? ?êÏàò ?úÍ≥Ñ??=====
    async loadMarketRegimeHistory(force = false) {
      if (this.marketRegimeHistory && !force) return;
      try {
        const r = await window.apiGet('/api/market-regime-history').catch(() => null);
        if (r && r.history && !r.__error) this.marketRegimeHistory = r.history;
      } catch (e) { console.error('[market-regime-history]', e); }
    },

    // ?±Í∏âÎ≥?Ï∞®Ìä∏ ?∞Ïù¥??(?ÑÏû¨ ?ÑÌÑ∞ ?úÏû•)
    gradeChartData() {
      if (!this.gradePerformance) return null;
      const market = this.matrixMarketFilter === 'KOSDAQ' ? 'kosdaq' : 'kospi';
      const data = this.gradePerformance[market] || {};
      const grades = ['A', 'B', 'C', 'D', 'F'];
      // sell1 +10d ?âÍ∑† (?êÏ†à ??Ï∂îÍ??òÎùΩ ???åÏàòÍ∞Ä ?¥ÏàòÎ°??òÌïú ?êÏ†à)
      const sell1Data = grades.map((g) => {
        const d = data[g];
        if (!d || !d.byType || !d.byType.sell1) return 0;
        return d.byType.sell1.avgReturn10d;
      });
      // buy1 +10d ?âÍ∑† (Îß§Ïàò ???ÅÏäπ ???ëÏàòÍ∞Ä ?¥ÏàòÎ°??òÌïú Îß§Ïàò)
      const buy1Data = grades.map((g) => {
        const d = data[g];
        if (!d || !d.byType || !d.byType.buy1) return 0;
        return d.byType.buy1.avgReturn10d;
      });
      // ?±Í∏âÎ≥??†Ìò∏ ??
      const countData = grades.map((g) => (data[g]?.signalCount || 0));
      return { grades, sell1: sell1Data, buy1: buy1Data, count: countData };
    },

    // ===== Îß§Ìä∏Î¶?ä§ ?êÏàò Î∂ÑÌè¨ (?±Í∏âÎ≥?Ïπ¥Ïö¥?? =====
    matrixGradeDistribution(items) {
      const dist = { A: 0, B: 0, C: 0, D: 0, F: 0 };
      if (!Array.isArray(items)) return dist;
      for (const it of items) {
        const s = it.total_score || it.buy1Score || 0;
        if (s >= 90) dist.A++;
        else if (s >= 75) dist.B++;
        else if (s >= 60) dist.C++;
        else if (s >= 40) dist.D++;
        else dist.F++;
      }
      return dist;
    },

    // ===== Îß§Ìä∏Î¶?ä§ Î∂ÑÏÑù ???ÑÏû¨ ?ÑÌÑ∞ Í∏∞Ï? ?∞Ïù¥??=====
    matrixCurrentData() {
      if (this.matrixMarketFilter === 'KOSPI') return this.matrixVerifyKospi;
      if (this.matrixMarketFilter === 'KOSDAQ') return this.matrixVerifyKosdaq;
      // compare: KOSPI + KOSDAQ ?µÌï©
      const k = this.matrixVerifyKospi;
      const q = this.matrixVerifyKosdaq;
      if (!k && !q) return null;
      const items = [
        ...((k?.top || []).map((x) => ({ ...x, _market: 'KOSPI' }))),
        ...((q?.top || []).map((x) => ({ ...x, _market: 'KOSDAQ' }))),
      ];
      return {
        asOf: k?.asOf || q?.asOf,
        market: 'compare',
        count: items.length,
        items,
        stats: {
          kospi: k?.stats || {},
          kosdaq: q?.stats || {},
        },
      };
    },

    // ===== Îß§Ìä∏Î¶?ä§ Ï∞®Ìä∏ Í∑∏Î¶¨Í∏?=====
    _drawMatrixCharts() {
      if (!window.Chart) return;
      const data = this.matrixCurrentData();
      if (!data) return;

      // Ï∞®Ìä∏ 1: ?±Í∏â Î∂ÑÌè¨ (KOSPI vs KOSDAQ)
      try {
        const c1 = document.getElementById('matrixGradeChart');
        if (c1 && c1.clientWidth > 0) {
          if (this._charts.matrixGrade) { try { this._charts.matrixGrade.destroy(); } catch (_) {} }
          const kItems = this.matrixVerifyKospi?.top || [];
          const qItems = this.matrixVerifyKosdaq?.top || [];
          const kDist = this.matrixGradeDistribution(kItems);
          const qDist = this.matrixGradeDistribution(qItems);
          const labels = ['A(90+)', 'B(75+)', 'C(60+)', 'D(40+)', 'F(<40)'];
          this._charts.matrixGrade = new Chart(c1, {
            type: 'bar',
            data: {
              labels,
              datasets: [
                { label: 'KOSPI', data: [kDist.A, kDist.B, kDist.C, kDist.D, kDist.F], backgroundColor: 'rgba(220, 53, 69, 0.7)' },
                { label: 'KOSDAQ', data: [qDist.A, qDist.B, qDist.C, qDist.D, qDist.F], backgroundColor: 'rgba(13, 110, 253, 0.7)' },
              ],
            },
            options: {
              responsive: true, maintainAspectRatio: false,
              plugins: {
                legend: { position: 'top' },
                tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ': ' + ctx.parsed.y + 'Í∞? } },
              },
              scales: { y: { ticks: { stepSize: 1, precision: 0 }, beginAtZero: true } },
            },
          });
        }
      } catch (e) { console.error('[matrixGradeChart]', e); }

      // Ï∞®Ìä∏ 2: Îß§Ìä∏Î¶?ä§ ?êÏàò Î∂ÑÌè¨ (?àÏä§?†Í∑∏??
      try {
        const c2 = document.getElementById('matrixScoreHistChart');
        if (c2 && c2.clientWidth > 0) {
          if (this._charts.matrixScoreHist) { try { this._charts.matrixScoreHist.destroy(); } catch (_) {} }
          const items = this.matrixMarketFilter === 'KOSPI' ? (this.matrixVerifyKospi?.top || [])
            : this.matrixMarketFilter === 'KOSDAQ' ? (this.matrixVerifyKosdaq?.top || [])
            : [...(this.matrixVerifyKospi?.top || []), ...(this.matrixVerifyKosdaq?.top || [])];
          const buckets = Array(10).fill(0); // 0-9, 10-19, ..., 90-99
          for (const it of items) {
            const s = Math.max(0, Math.min(99, Math.round(it.total_score || 0)));
            buckets[Math.floor(s / 10)]++;
          }
          const labels = buckets.map((_, i) => `${i*10}-${i*10+9}`);
          this._charts.matrixScoreHist = new Chart(c2, {
            type: 'bar',
            data: { labels, datasets: [{ label: 'Ï¢ÖÎ™© ??, data: buckets, backgroundColor: 'rgba(99, 102, 241, 0.7)' }] },
            options: {
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ctx.parsed.y + 'Í∞? } } },
              scales: { y: { ticks: { stepSize: 1, precision: 0 }, beginAtZero: true } },
            },
          });
        }
      } catch (e) { console.error('[matrixScoreHistChart]', e); }
    },

    // ===== Îß§Ìä∏Î¶?ä§ ?±Í∏âÎ≥?1Ï∞®Îß§???úÏÑ± Ïπ¥Ïö¥??=====
    matrixGradeBuy1Stats() {
      const items = this.matrixCurrentData()?.items || this.matrixCurrentData()?.top || [];
      const groups = { A: { total: 0, active: 0 }, B: { total: 0, active: 0 }, C: { total: 0, active: 0 }, D: { total: 0, active: 0 }, F: { total: 0, active: 0 } };
      for (const it of items) {
        const s = it.total_score || 0;
        let g = 'F';
        if (s >= 90) g = 'A';
        else if (s >= 75) g = 'B';
        else if (s >= 60) g = 'C';
        else if (s >= 40) g = 'D';
        groups[g].total++;
        if (it.buy1Active) groups[g].active++;
      }
      return groups;
    },

    // ===== ?±Í∏âÎ≥?Ï∞®Ìä∏ Í∑∏Î¶¨Í∏?=====
    _drawGradeChart() {
      if (!window.Chart) return;
      const data = this.gradeChartData();
      if (!data) return;
      try {
        const c = document.getElementById('gradePerformanceChart');
        if (!c || c.clientWidth === 0) return;
        if (this._charts.gradePerf) { try { this._charts.gradePerf.destroy(); } catch (_) {} this._charts.gradePerf = null; }
        this._charts.gradePerf = new Chart(c, {
          type: 'bar',
          data: {
            labels: data.grades,
            datasets: [
              { label: '1Ï∞®Îß§??+10d (?åÏàò=?òÌïú ?êÏ†à)', data: data.sell1, backgroundColor: data.sell1.map((v) => v <= 0 ? 'rgba(220, 53, 69, 0.7)' : 'rgba(13, 110, 253, 0.7)') },
              { label: '1Ï∞®Îß§??+10d (?ëÏàò=?òÌïú Îß§Ïàò)', data: data.buy1, backgroundColor: data.buy1.map((v) => v >= 0 ? 'rgba(34, 197, 94, 0.7)' : 'rgba(13, 110, 253, 0.7)') },
            ],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ': ' + ctx.parsed.y.toFixed(2) + '%' } } },
            scales: { y: { ticks: { callback: (v) => v + '%' } } },
          },
        });
      } catch (e) { console.error('[gradePerformanceChart]', e); }
    },

    // ===== ?úÏû• ?âÍ? ?êÏàò ?úÍ≥Ñ??Ï∞®Ìä∏ =====
    _drawMarketHistoryChart() {
      if (!window.Chart || !this.marketRegimeHistory) return;
      try {
        const c = document.getElementById('marketRegimeHistoryChart');
        if (!c || c.clientWidth === 0) return;
        if (this._charts.marketHistory) { try { this._charts.marketHistory.destroy(); } catch (_) {} this._charts.marketHistory = null; }
        const hist = this.marketRegimeHistory;
        const labels = hist.map((h) => h.date.slice(5));  // MM-DD
        const scores = hist.map((h) => h.score);
        const trends = hist.map((h) => h.components.trend);
        const breadths = hist.map((h) => h.components.breadth);
        this._charts.marketHistory = new Chart(c, {
          type: 'line',
          data: {
            labels,
            datasets: [
              { label: '?úÏû• ?âÍ? ?êÏàò', data: scores, borderColor: '#6366f1', backgroundColor: 'rgba(99, 102, 241, 0.2)', fill: true, tension: 0.3, pointRadius: 2, yAxisID: 'y' },
              { label: 'Ï∂îÏÑ∏ (25%)', data: trends, borderColor: '#ef4444', tension: 0.3, pointRadius: 0, yAxisID: 'y' },
              { label: 'Breadth (25%)', data: breadths, borderColor: '#10b981', tension: 0.3, pointRadius: 0, yAxisID: 'y' },
              { label: 'Ï§ëÎ¶Ω (50)', data: scores.map(() => 50), borderColor: '#9ca3af', borderDash: [5, 5], pointRadius: 0, yAxisID: 'y' },
            ],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ': ' + (ctx.parsed.y || 0).toFixed(1) } } },
            scales: {
              y: { min: 0, max: 100, ticks: { callback: (v) => v + '?? }, title: { display: true, text: '?êÏàò' } },
            },
          },
        });
      } catch (e) { console.error('[marketRegimeHistoryChart]', e); }
    },

    signalKpi() {
      const s = this.signalPerformance;
      if (!s) return {};
      const sum = s.summary || {};
      const k = this.signalPerformanceKosdaq?.summary || {}; // KOSDAQ KPI
      const fmt = (v) => (v === null || v === undefined) ? '?? : (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
      const mkCard = (t, label, sub, color) => ({
        label,
        main: fmt(sum[t]?.avgReturn10d),
        sub: `${sum[t]?.total || 0}Í±?¬∑ KOSPI`,
        color,
        kosdaqMain: k[t]?.avgReturn10d !== undefined ? `KOSDAQ ${fmt(k[t].avgReturn10d)}` : 'KOSDAQ ??,
        kosdaqSub: k[t] ? `${k[t].total}Í±? : '',
      });
      return {
        buy1: mkCard('buy1', '?? 1Ï∞®Îß§??, '+10???âÍ∑†', (sum.buy1?.avgReturn10d || 0) >= 0 ? 'text-danger' : 'text-primary'),
        buy2: mkCard('buy2', '?õí 2Ï∞®Îß§??, '+10???âÍ∑†', (sum.buy2?.avgReturn10d || 0) >= 0 ? 'text-danger' : 'text-primary'),
        sell1: mkCard('sell1', '?õë 1Ï∞®Îß§??(?êÏ†à)', '?êÏ†à ??Ï∂îÍ??òÎùΩ', 'text-primary'),
        sell2: mkCard('sell2', '?í∞ 2Ï∞®Îß§??(?µÏ†à)', '?µÏ†à ??Ï∂îÍ??ÅÏäπ', 'text-muted'),
      };
    },

    signalTypeLabel(t) {
      return { buy1: '1Ï∞®Îß§??, buy2: '2Ï∞®Îß§??, sell1: '1Ï∞®Îß§??, sell2: '2Ï∞®Îß§?? }[t] || t;
    },

    signalTypeDesc(t) {
      return {
        buy1: 'Í≥®Îì†?¨Î°ú???ïÎ∞∞??,
        buy2: '?åÎ¶ºÎ™??ëÎ¥â',
        sell1: '?êÏ†à -7%',
        sell2: '?µÏ†à +21%',
      }[t] || '';
    },

    signalTypeColor(t) {
      return { buy1: 'bg-danger', buy2: 'bg-warning text-dark', sell1: 'bg-primary', sell2: 'bg-success' }[t] || 'bg-secondary';
    },

    // ===== Í∞ÄÏ§ëÏπò ?¨Îùº?¥Îçî (?§ÏãúÍ∞? =====
    updateWeight(key, value) {
      // ?¨Îùº?¥Îçî Î≥ÄÍ≤????ïÍ∑ú??
      this.currentWeights = { ...this.currentWeights, [key]: Number(value) };
    },
    normalizeWeights() {
      const w = this.currentWeights;
      const sum = (w.value || 0) + (w.momentum || 0) + (w.quality || 0) +
                  (w.volatility || 0) + (w.growth || 0) + (w.liquidity || 0) + (w.supply || 0);
      if (sum === 0) return;
      this.currentWeights = {
        value: Math.round((w.value / sum) * 100),
        momentum: Math.round((w.momentum / sum) * 100),
        quality: Math.round((w.quality / sum) * 100),
        volatility: Math.round((w.volatility / sum) * 100),
        growth: Math.round((w.growth / sum) * 100),
        liquidity: Math.round((w.liquidity / sum) * 100),
        supply: Math.round((w.supply / sum) * 100),
      };
    },

    // CSV ?§Ïö¥Î°úÎìú (??Ï¢ÖÎ™© ?êÏàò) ???§Î•∏ ?Ä???Ä?úÎ≥¥?úÏ? Ï∞®Î≥Ñ??
    downloadCsv() {
      if (!this.all || this.all.length === 0) return;
      const rows = [['?úÏúÑ', 'ÏΩîÎìú', 'Ï¢ÖÎ™©Î™?, '?úÏû•', '?πÌÑ∞', '?±Í∏â', 'Í∞ÄÏπ?, 'Î™®Î©ò?Ä', '?ÑÎ¶¨??, '?ÄÎ≥Ä??, '?±Ïû•', '?†Îèô', '?òÍ∏â', 'Ï¥ùÏ†ê', '?ÅÌÉú']];
      // ?ïÎ†¨: total_score desc
      const sorted = [...this.all].sort((a, b) => (b.total_score || 0) - (a.total_score || 0));
      for (const r of sorted) {
        rows.push([
          r.rank || '',
          r.code,
          r.name || '',
          r.market || '',
          r.sector || '',
          r.grade?.letter || '',
          r.value_score?.toFixed(2) || '',
          r.momentum_score?.toFixed(2) || '',
          r.quality_score?.toFixed(2) || '',
          r.volatility_score?.toFixed(2) || '',
          r.growth_score?.toFixed(2) || '',
          r.liquidity_score?.toFixed(2) || '',
          r.supply_score?.toFixed(2) || '',
          r.total_score?.toFixed(2) || '',
          r.status || '',
        ]);
      }
      const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      // BOM Ï∂îÍ? (?ëÏ? ?úÍ? Íπ®Ïßê Î∞©Ï?)
      const bom = '\uFEFF';
      const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const today = new Date().toISOString().slice(0, 10);
      const mkt = this.marketFilter || 'ALL';
      link.href = url;
      link.download = `quant_${mkt}_${today}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    },

    // ??10Ï¢ÖÎ™© Î∂ÑÏÇ∞ ?¨Ìä∏?¥Î¶¨??CSV ?§Ïö¥Î°úÎìú
    downloadPortfolioCsv() {
      if (!this.portfolio?.items?.length) return;
      const rows = [['?úÏúÑ', 'ÏΩîÎìú', 'Ï¢ÖÎ™©Î™?, '?úÏû•', '?πÌÑ∞', '?±Í∏â', 'Ï¥ùÏ†ê', 'ÎπÑÏ§ë(%)', '?ÑÏû¨Í∞Ä', '?∏Ïù∏ 5??, 'Í∏∞Í? 5??]];
      for (const p of this.portfolio.items) {
        rows.push([
          p.rank, p.code, p.name || '', p.market || '', p.sector || '',
          p.grade?.letter || '', (p.total_score || 0).toFixed(2), (p.weight || 0).toFixed(1),
          (p.close || 0).toLocaleString(), p.foreign_5d || 0, p.inst_5d || 0,
        ]);
      }
      const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      const bom = '\uFEFF';
      const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const today = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = `quant_portfolio_${today}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    },
  };
}
