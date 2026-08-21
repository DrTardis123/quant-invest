// 7팩터 재계산 (가치/모멘텀/퀄리티/저변동/성장/유동/수급)
// 서버 src/scoring/index.js recomputeWithWeights 와 동일한 식이어야 함.
window.recomputeWithWeights=function(rows,weights){if(!Array.isArray(rows))return[];const W=weights||window.QUANT_STRATEGIES.balanced.weights;const wv=Number(W.value)||0,wm=Number(W.momentum)||0,wq=Number(W.quality)||0,wlv=Number(W.volatility)||0,wg=Number(W.growth)||0,wliq=Number(W.liquidity)||0,wsup=Number(W.supply)||0;const wsum=(wv+wm+wq+wlv+wg+wliq+wsup)||100;const out=rows.map((r)=>{const total=((Number(r.value_score)||0)*wv+
(Number(r.momentum_score)||0)*wm+
(Number(r.quality_score)||0)*wq+
(Number(r.volatility_score)||0)*wlv+
(Number(r.growth_score)||0)*wg+
(Number(r.liquidity_score)||0)*wliq+
(Number(r.supply_score)||0)*wsup)/wsum;return{...r,recomputed_total:Math.round(total*100)/100};});out.sort((a,b)=>b.recomputed_total-a.recomputed_total);out.forEach((r,i)=>(r.recomputed_rank=i+1));return out;};window.scoreColor=function(v){if(v===null||v===undefined||!Number.isFinite(v))return'#adb5bd';if(v>=80)return'#198754';if(v>=70)return'#20c997';if(v>=60)return'#0dcaf0';if(v>=50)return'#0d6efd';if(v>=40)return'#fd7e14';if(v>=30)return'#dc3545';return'#842029';};
