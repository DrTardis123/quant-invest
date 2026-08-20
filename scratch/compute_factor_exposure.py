# -*- coding: utf-8 -*-
"""
compute_factor_exposure.py
팩터 crowding 모니터용 데이터 생성.

- 입력: public/data/portfolio.json (10종목, 7팩터 점수 + 섹터)
- 출력:
  * public/data/factor-exposure.json (7팩터 exposure, HHI, z-score)
  * public/data/sector-exposure.json (섹터 분포)

정의:
  Factor exposure (raw): 각 팩터 점수의 가중 평균 (0~100, 동수가중)
  Factor exposure (z): (raw - 50) / 17 (정규분포 가정, ±1σ ≈ 17 percentile)
  HHI: Σ w_i^2 (정규화 weight, Σw=1)
  HHI_baseline: 1/N (균등 가중치)
  HHI threshold: 균등 × 1.5 ≈ 집중 경고
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# Windows 콘솔(cp949) 인코딩 문제 회피 — UTF-8 강제
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(r"C:\Users\LG\Documents\quant_invest")
PORTFOLIO = ROOT / "public" / "data" / "portfolio.json"
DYNAMIC_PORTFOLIO = ROOT / "public" / "data" / "dynamic-portfolio.json"
FACTOR_OUT = ROOT / "public" / "data" / "factor-exposure.json"
SECTOR_OUT = ROOT / "public" / "data" / "sector-exposure.json"

FACTOR_KEYS = ["value", "momentum", "quality", "volatility", "growth", "liquidity", "supply"]
FACTOR_LABELS = {
    "value": "가치",
    "momentum": "모멘텀",
    "quality": "퀄리티",
    "volatility": "저변동",
    "growth": "성장",
    "liquidity": "유동성",
    "supply": "수급",
}
FACTOR_COLORS = {
    "value": "#0d6efd",
    "momentum": "#198754",
    "quality": "#fd7e14",
    "volatility": "#6f42c1",
    "growth": "#dc3545",
    "liquidity": "#20c997",
    "supply": "#ffc107",
}


def main():
    with PORTFOLIO.open("r", encoding="utf-8") as f:
        portfolio = json.load(f)
    try:
        with DYNAMIC_PORTFOLIO.open("r", encoding="utf-8") as f:
            dyn = json.load(f)
    except FileNotFoundError:
        dyn = {}

    items = portfolio.get("items", [])
    n = len(items)
    if n == 0:
        raise SystemExit("portfolio.json에 items가 없습니다.")

    # === 1) 팩터 exposure (가중 평균) ===
    weights = [it.get("weight", 0) for it in items]
    total_w = sum(weights) or 1
    w_norm = [w / total_w for w in weights]

    factor_exposures = []
    for key in FACTOR_KEYS:
        col = f"{key}_score"
        raw = sum((it.get(col, 0) or 0) * wn for it, wn in zip(items, w_norm))
        z = (raw - 50.0) / 17.0  # ±1σ ≈ 17 percentile (정규분포 가정)
        factor_exposures.append({
            "key": key,
            "label": FACTOR_LABELS[key],
            "color": FACTOR_COLORS[key],
            "raw": round(raw, 2),
            "zScore": round(z, 3),
            "direction": "long" if z >= 0 else "short",
        })

    # === 2) HHI ===
    # raw 점수를 0~100 사이로 정규화하고, 절대값(음수는 short 노출) 고려해서 weight로 변환
    # long/short 노출 모두 반영: exposure = zScore (signed)
    # weight_i = max(0, exposure_i) / Σ max(0, exposure_j)  (gross exposure 100%)
    # 단, short는 별도로 표시하고 HHI는 gross exposure 기준
    positives = [max(0.0, fe["zScore"]) for fe in factor_exposures]
    pos_sum = sum(positives)
    if pos_sum > 0:
        w_pos = [p / pos_sum for p in positives]
    else:
        # 모든 팩터가 약한 short — 균등으로 fallback
        w_pos = [1.0 / len(factor_exposures)] * len(factor_exposures)

    hhi = sum(w * w for w in w_pos)
    hhi_equal = 1.0 / len(factor_exposures)
    hhi_concentrated = hhi_equal * 1.5  # 1.5배 이상이면 집중

    # 7팩터 HHI baseline = 1/7 = 0.143 (요청 1/13 = 0.077와 다름 — 시스템은 7팩터)
    # 사용자에게 명확히 알리기 위해 hhiEqual13도 함께 노출
    hhi_equal_13 = 1.0 / 13

    if hhi <= hhi_equal * 1.1:
        level = "low"
        level_label = "낮음"
        risk = "✅ 균등"
        risk_console = "[OK] 균등"
    elif hhi <= hhi_concentrated:
        level = "moderate"
        level_label = "보통"
        risk = "⚠️ 보통"
        risk_console = "[!] 보통"
    else:
        level = "high"
        level_label = "높음"
        risk = "🚨 집중"
        risk_console = "[HIGH] 집중"

    # === 3) Top-N stock concentration ===
    sorted_w = sorted(weights, reverse=True)
    top5 = sum(sorted_w[:5]) / total_w
    top3 = sum(sorted_w[:3]) / total_w
    top1 = (sorted_w[0] if sorted_w else 0) / total_w

    # === 4) 섹터 분포 ===
    sector_dist = portfolio.get("sectorDistribution", {}) or {}
    sectors = []
    for sec, cnt in sector_dist.items():
        # 섹터별 weight (해당 섹터 종목 weight 합)
        sec_weight = sum(
            (it.get("weight", 0) or 0)
            for it in items
            if it.get("sector") == sec
        )
        sectors.append({
            "sector": sec,
            "count": int(cnt),
            "weight": round(sec_weight, 2),
        })
    sectors.sort(key=lambda x: -x["weight"])

    # === JSON 출력 ===
    as_of = portfolio.get("asOf") or datetime.now(timezone.utc).isoformat()

    factor_out = {
        "asOf": as_of,
        "nStocks": n,
        "weightingScheme": "equal-weight (1/N=" + f"{100.0/n:.1f}" + "%)",
        "nFactors": len(factor_exposures),
        "factors": factor_exposures,
        "hhi": {
            "value": round(hhi, 4),
            "equalBaseline": round(hhi_equal, 4),
            "equalBaseline13": round(hhi_equal_13, 4),
            "concentratedThreshold": round(hhi_concentrated, 4),
            "level": level,
            "levelLabel": level_label,
            "riskBadge": risk,
        },
        "topConcentration": {
            "top1": round(top1, 4),
            "top3": round(top3, 4),
            "top5": round(top5, 4),
        },
        "metadata": {
            "note": "7팩터 시스템 (요청 13팩터와 다름). z-score: (raw-50)/17 가정. long/short 부호는 raw>50 ⇒ long.",
            "factorKeys": FACTOR_KEYS,
            "asOf": as_of,
        },
    }
    sector_out = {
        "asOf": as_of,
        "nSectors": len(sectors),
        "nStocks": n,
        "sectors": sectors,
    }

    # UTF-8 (BOM 없음) — 기존 JSON 파일과 동일 컨벤션
    for path, obj in [(FACTOR_OUT, factor_out), (SECTOR_OUT, sector_out)]:
        with path.open("w", encoding="utf-8", newline="\n") as g:
            json.dump(obj, g, ensure_ascii=False, indent=2)
        print(f"[OK] {path}  ({path.stat().st_size} bytes)")

    # 사람이 읽기 좋은 요약
    print()
    print("=" * 60)
    print(f"포트폴리오 ({n}종목, {portfolio.get('weightingScheme', 'equal-weight')})")
    print("=" * 60)
    print(f"{'팩터':<8} {'raw':>6} {'z':>6} {'long/short':>11}")
    for fe in factor_exposures:
        arrow = "▲ long" if fe["direction"] == "long" else "▽ short"
        print(f"{fe['label']:<8} {fe['raw']:>6.2f} {fe['zScore']:>+6.2f} {arrow:>11}")
    print()
    print(f"HHI (gross exposure): {hhi:.4f}")
    print(f"  - 균등 baseline (1/7) = {hhi_equal:.4f}")
    print(f"  - 균등 baseline (1/13, 요청값) = {hhi_equal_13:.4f}")
    print(f"  - 집중 경고 (균등×1.5) = {hhi_concentrated:.4f}")
    print(f"  - 판정: {level} ({risk_console})")
    print()
    print(f"Top-1: {top1*100:.1f}%  Top-3: {top3*100:.1f}%  Top-5: {top5*100:.1f}%")
    print()
    print(f"섹터 ({len(sectors)}개):")
    for s in sectors:
        print(f"  - {s['sector']:<20} {s['weight']:>5.1f}%  ({s['count']}종목)")


if __name__ == "__main__":
    main()
