(function(){'use strict';let _loadPromise=null;let _Chart=null;let _loading=false;let _callbacks=[];function _flushCallbacks(){_callbacks.forEach((cb)=>{try{cb(window.Chart);}catch(e){console.error('[chart-loader] callback err:',e);}});_callbacks=[];}
async function load(){if(_Chart)return _Chart;if(_loadPromise)return _loadPromise;_loadPromise=(async()=>{console.log('[chart-loader] dynamic import Chart.js...');const t0=performance.now();try{_Chart=await _loadScript();const ms=(performance.now()-t0).toFixed(0);console.log(`[chart-loader] Chart.js loaded in ${ms}ms`);_loading=false;_flushCallbacks();return _Chart;}catch(e){console.error('[chart-loader] load failed:',e);_loadPromise=null;_loading=false;throw e;}})();return _loadPromise;}
function _loadScript(){return new Promise((resolve,reject)=>{if(window.Chart&&window.Chart.version){resolve(window.Chart);return;}
const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js';s.async=false;s.onload=()=>{if(window.Chart)resolve(window.Chart);else reject(new Error('Chart not exposed after load'));};s.onerror=(e)=>reject(new Error('Chart.js script load failed'));document.head.appendChild(s);});}
function preload(){if(_Chart||_loadPromise)return _loadPromise;if(!_loading){_loading=true;load().catch((e)=>console.warn('[chart-loader] preload failed:',e));}
return _loadPromise;}
function onReady(cb){if(_Chart){cb(_Chart);return;}
_callbacks.push(cb);if(!_loading)preload();}
async function ready(cb){const C=await load();if(cb)cb(C);return C;}
function isLoaded(){return!!_Chart;}
function isLoading(){return!!_loadPromise&&!_Chart;}
window.ChartLoader={load,preload,onReady,ready,isLoaded,isLoading};console.log('[chart-loader] ready (lazy)');})();