"""외국인 flow regime 자동 갱신 (cron-friendly)

장 마감 후 (평일 16:30 KST) 자동 실행.
KOSPI/KOSDAQ 시장 전체 외국인 5일 누적 순매수를 추정하여 regime 계산 후
public/data/supply-signals.json의 regime 필드만 업데이트한다.

데이터 소스 (우선순위):
  1. primary: public/data/stock/{code}.json (30개 종목)
     - 각 파일의 investor_flow 최근 5일치 close × foreign_net 합산
     - close는 원, foreign_net은 주 단위 → 곱하면 KRW
     - 30개 합산 = KOSPI 200 상위 + KOSDAQ 100 상위의 외인 활동 ≈ 시장 광의 proxy
     - 가장 정확 (실제 거래 데이터)
  2. fallback (GH Actions/원격): public/data/heatmap.json
     - 80개 종목 close + supply-signals.json의 foreign_5d (주) 사용
  3. last-resort: public/data/supply-signals.json의 foreign_5d 합산
     - close 환산 없이 shares 그대로 → KRW 모름, 의미 있는 숫자 아님
     - 손실 방지를 위해 0 처리 + note에 명시
  4. cross-check: Naver KOSPI 일일 외인 (가능하면)

설계:
  - 표준 라이브러리만 사용 (urllib + json + sqlite3) → venv 차이/Windows-Linux 호환
  - 30일 rolling history 유지
  - UTF-8 no-BOM 보존 (현재 supply-signals.json 형식)
  - 5일 평균 (1d_avg) 단위: B USD (1e9 USD)

scratch/update_flow_regime.py 와 동일한 코드. cron/GH Actions import path 통일을 위해
scripts/ 에도 동일하게 둔다. 수정 시 양쪽 동기화 필요.

사용법:
  python update_flow_regime.py [--dry-run] [--source auto|stocks|heatmap|signals]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

# ------------------------------------------------------------------
# Paths & constants
# ------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent  # scripts/ 의 부모 = quant_invest/
SUPPLY_JSON = ROOT / "public" / "data" / "supply-signals.json"
STOCK_DIR = ROOT / "public" / "data" / "stock"
HEATMAP_JSON = ROOT / "public" / "data" / "heatmap.json"

KRW_PER_USD = 1300  # 단순 환율 가정 (정밀 환율 필요 시 FRED:DEXKOUS 사용)

THRESH_GREEN_TO_YELLOW = 0.6   # 75th percentile (KOSPI 2021-25 quantile)
THRESH_YELLOW_TO_RED = 1.2     # 90th percentile
THRESH_RED_EXTREME = 2.0       # 99th percentile

HISTORY_DAYS = 30               # rolling history 보관 일수
HISTORY_MAX = 60                # 절대 상한

# KST 타임존 (cron은 local time으로 도는 경우 대비)
KST = timezone(timedelta(hours=9))


# ------------------------------------------------------------------
# Logging
# ------------------------------------------------------------------
def log(*args):
    print("[update_flow_regime]", *args, flush=True)


# ------------------------------------------------------------------
# Supply-signals.json 로드
# ------------------------------------------------------------------
def load_supply_signals() -> dict:
    if not SUPPLY_JSON.exists():
        raise FileNotFoundError(f"supply-signals.json 없음: {SUPPLY_JSON}")
    raw = SUPPLY_JSON.read_bytes()
    # BOM 보존 (현재 no-BOM이지만 방어적)
    if raw.startswith(b"\xef\xbb\xbf"):
        text = raw.decode("utf-8-sig")
    else:
        text = raw.decode("utf-8")
    return json.loads(text)


def get_buy_sell_codes(data: dict) -> list[str]:
    """buy + sell에서 중복 제거된 코드 리스트"""
    codes = []
    seen = set()
    for s in (data.get("buy") or []) + (data.get("sell") or []):
        c = s.get("code")
        if c and c not in seen:
            seen.add(c)
            codes.append(c)
    return codes


# ------------------------------------------------------------------
# Source 1: public/data/stock/{code}.json (가장 정확)
# ------------------------------------------------------------------
def compute_from_stock_files(codes: list[str]) -> tuple[int | None, str]:
    """각 종목의 investor_flow 5일치 close × foreign_net 합산.

    Returns:
        (total_krw, note)
    """
    if not STOCK_DIR.exists():
        return None, f"stock 디렉토리 없음: {STOCK_DIR}"

    total_krw = 0
    hit = 0
    miss = 0
    for code in codes:
        fp = STOCK_DIR / f"{code}.json"
        if not fp.exists():
            miss += 1
            continue
        try:
            with open(fp, encoding="utf-8") as f:
                d = json.load(f)
            inv = d.get("investor_flow") or []
            if not isinstance(inv, list) or not inv:
                miss += 1
                continue
            used = 0
            for entry in inv[:5]:
                if not isinstance(entry, dict):
                    continue
                close = entry.get("close")
                foreign_net = entry.get("foreign_net")
                if close and foreign_net is not None:
                    try:
                        total_krw += int(close) * int(foreign_net)
                        used += 1
                    except (TypeError, ValueError):
                        pass
            if used > 0:
                hit += 1
            else:
                miss += 1
        except Exception as e:
            log(f"  [stocks] {code} parse err: {e}")
            miss += 1

    note = f"stocks/{len(codes)}개 종목의 investor_flow 5일치 close×foreign_net 합산 (hit {hit}/miss {miss})"
    return total_krw, note


# ------------------------------------------------------------------
# Source 2: heatmap.json close + supply-signals foreign_5d (fallback)
# ------------------------------------------------------------------
def compute_from_heatmap(codes: list[str], data: dict) -> tuple[int | None, str]:
    """heatmap.json의 close + supply-signals의 foreign_5d (주) → KRW"""
    if not HEATMAP_JSON.exists():
        return None, f"heatmap.json 없음: {HEATMAP_JSON}"
    try:
        h = json.loads(HEATMAP_JSON.read_text(encoding="utf-8"))
    except Exception as e:
        return None, f"heatmap.json parse 실패: {e}"
    items = h if isinstance(h, list) else h.get("items") or h.get("data") or []
    close_map: dict[str, float] = {}
    for x in items:
        c = x.get("code")
        cl = x.get("close")
        if c and cl is not None:
            try:
                close_map[str(c)] = float(cl)
            except (TypeError, ValueError):
                pass

    f5_map: dict[str, int] = {}
    for s in (data.get("buy") or []) + (data.get("sell") or []):
        c = s.get("code")
        if c:
            f5_map[str(c)] = int(s.get("foreign_5d", 0) or 0)

    total_krw = 0
    hit = 0
    miss = 0
    for code in codes:
        close = close_map.get(code)
        shares = f5_map.get(code, 0)
        if close and shares:
            total_krw += int(close * shares)
            hit += 1
        else:
            miss += 1

    note = f"heatmap.json({len(close_map)}개) close × supply-signals foreign_5d 합산 (hit {hit}/miss {miss})"
    return total_krw, note


# ------------------------------------------------------------------
# Source 3: Naver KOSPI 일일 외인 (cross-check)
# ------------------------------------------------------------------
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)


def _http_get(url: str, timeout: int = 12) -> str | None:
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": UA, "Referer": "https://finance.naver.com/"},
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            charset = resp.headers.get_content_charset() or "euc-kr"
            return resp.read().decode(charset, errors="replace")
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        log(f"  [naver] GET 실패 {url[:60]}: {e}")
        return None


def fetch_naver_kospi_foreign_today() -> float | None:
    """Naver KOSPI 일일 외인 순매수 (억원) → float KRW. 실패 시 None.

    모바일 m.stock.naver.com API는 2024~2025 사이 404 (구조 변경).
    데스크톱 finance.naver.com 도 시장 합계 페이지는 404 → 사용 불가.
    """
    html = _http_get("https://finance.naver.com/sise/sise_index.naver?code=KOSPI")
    if not html:
        return None
    patterns = [
        r"<th[^>]*>\s*외인순매수\s*</th>\s*<td[^>]*>(?:\s*<[^>]+>)*\s*([+\-]?[\d,]+)",
        r"<th[^>]*>\s*외국인\s*</th>\s*<td[^>]*>(?:\s*<[^>]+>)*\s*([+\-]?[\d,]+)",
        r"<th[^>]*>\s*외인\s*</th>\s*<td[^>]*>(?:\s*<[^>]+>)*\s*([+\-]?[\d,]+)",
    ]
    for pat in patterns:
        m = re.search(pat, html, re.IGNORECASE | re.DOTALL)
        if m:
            val = int(m.group(1).replace(",", "").replace("+", ""))
            return val * 1e8  # KRW
    return None


# ------------------------------------------------------------------
# Regime 계산
# ------------------------------------------------------------------
def classify_regime(flow_1d_avg_billion_usd: float) -> tuple[str, float, str, str]:
    """return (regime, position_scale, color, emoji)"""
    abs_flow = abs(flow_1d_avg_billion_usd)
    if abs_flow >= THRESH_RED_EXTREME:
        return "RED_EXTREME", 0.375, "#dc3545", "🚨"
    if abs_flow >= THRESH_YELLOW_TO_RED:
        return "RED", 0.5, "#fd7e14", "🔴"
    if abs_flow >= THRESH_GREEN_TO_YELLOW:
        return "YELLOW", 0.75, "#ffc107", "🟡"
    return "GREEN", 1.0, "#198754", "🟢"


def build_note(direction: str, flow_1d_b: float, source_label: str, sign_match: bool | None = None) -> str:
    if direction == "OUTFLOW":
        prefix = f"외인 일일 순유출 ${abs(flow_1d_b):.2f}B"
    else:
        prefix = f"외인 일일 순유입 ${flow_1d_b:.2f}B"
    note = f"{prefix} (auto, {source_label}). 환율 1,300 KRW/USD 가정. 임계값 KOSPI 2021-25 quantile."
    if sign_match is False:
        note += " ※ Naver 일일 외인과 부호 불일치"
    return note


# ------------------------------------------------------------------
# History rolling merge
# ------------------------------------------------------------------
def merge_history(prev_history: list, today: dict) -> list:
    today_date = today["date"]
    out = []
    for h in prev_history or []:
        if h.get("date") == today_date:
            continue
        out.append(h)
    out.append(today)
    out.sort(key=lambda x: x.get("date", ""))
    if len(out) > HISTORY_MAX:
        out = out[-HISTORY_MAX:]
    return out[-HISTORY_DAYS:] if len(out) > HISTORY_DAYS else out


# ------------------------------------------------------------------
# Main
# ------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="외국인 flow regime 자동 갱신")
    parser.add_argument("--dry-run", action="store_true", help="파일 쓰지 않고 stdout만")
    parser.add_argument(
        "--source",
        choices=["auto", "stocks", "heatmap", "signals"],
        default="auto",
        help=(
            "auto=stocks→heatmap→signals 순 fallback / "
            "stocks=stock/*.json 만 / heatmap=heatmap.json 만 / signals=supply-signals foreign_5d 만"
        ),
    )
    args = parser.parse_args()

    data = load_supply_signals()
    prev_regime = data.get("regime") or {}
    prev_history = prev_regime.get("history") or []

    today_str = datetime.now(KST).strftime("%Y-%m-%d")
    codes = get_buy_sell_codes(data)
    log(f"as_of: {today_str}")
    log(f"buy+sell unique codes: {len(codes)}")
    log(f"source: {args.source}")

    flow_5d_krw: int | None = None
    source_label = ""

    if args.source in ("auto", "stocks"):
        total, note = compute_from_stock_files(codes)
        if total is not None:
            if total != 0 or args.source == "stocks":
                flow_5d_krw = total
                source_label = note
                log(f"  [primary:stocks] {note}")
                log(f"  [primary:stocks] total = {flow_5d_krw:+,} KRW ({flow_5d_krw/1e8:+,.1f}억원)")

    if flow_5d_krw is None and args.source in ("auto", "heatmap"):
        total, note = compute_from_heatmap(codes, data)
        if total is not None:
            flow_5d_krw = total
            source_label = note
            log(f"  [fallback:heatmap] {note}")
            log(f"  [fallback:heatmap] total = {flow_5d_krw:+,} KRW ({flow_5d_krw/1e8:+,.1f}억원)")

    if flow_5d_krw is None and args.source in ("auto", "signals"):
        f5_total = sum(int(s.get("foreign_5d", 0) or 0) for s in (data.get("buy") or []) + (data.get("sell") or []))
        log(f"  [last-resort:signals] foreign_5d total shares = {f5_total:+,} (KRW 환산 불가)")
        flow_5d_krw = 0
        source_label = f"supply-signals foreign_5d 합산 {f5_total:+,}주 (KRW 환산 불가 → 보수적 추정 0)"

    if flow_5d_krw is None:
        log("❌ 모든 소스 실패. regime 갱신 불가.")
        print(json.dumps({"ok": False, "error": "all sources failed"}, ensure_ascii=False))
        return 1

    flow_5d_b = flow_5d_krw / 1e9 / KRW_PER_USD
    flow_1d_b = flow_5d_b / 5
    log(f"  → flow_5d_total = {flow_5d_krw:+,} KRW ({flow_5d_krw/1e8:+,.1f}억원)")
    log(f"  → flow_1d_avg    = ${flow_1d_b:+.3f}B USD")

    sign_match: bool | None = None
    naver_krw = fetch_naver_kospi_foreign_today()
    if naver_krw is not None:
        naver_1d_b = naver_krw / 1e9 / KRW_PER_USD
        log(f"  [cross-check:naver] KOSPI today = {naver_krw:+,} KRW (${naver_1d_b:+.3f}B)")
        if abs(naver_1d_b) > 0.01:
            sign_match = (flow_1d_b >= 0) == (naver_1d_b >= 0)
            if not sign_match:
                log(f"  [cross-check] 부호 불일치: ours={flow_1d_b:+.3f} vs naver={naver_1d_b:+.3f}")
            else:
                log(f"  [cross-check] 부호 일치: ours={flow_1d_b:+.3f} vs naver={naver_1d_b:+.3f}")
    else:
        log("  [cross-check:naver] KOSPI 외인 fetch 실패 (cross-check 생략)")

    regime, position_scale, color, emoji = classify_regime(flow_1d_b)
    direction = "INFLOW" if flow_1d_b > 0 else "OUTFLOW"
    log(f"  → regime={regime} {emoji}  direction={direction}  position_scale={position_scale*100:.1f}%")

    full_note = build_note(direction, flow_1d_b, source_label=source_label, sign_match=sign_match)

    history_entry = {
        "date": today_str,
        "flow_1d_avg_billion_usd": round(flow_1d_b, 3),
        "regime": regime,
    }
    new_history = merge_history(prev_history, history_entry)
    log(f"  history entries: {len(new_history)} (prev {len(prev_history)})")

    new_regime = {
        "as_of": today_str,
        "regime": regime,
        "direction": direction,
        "flow_1d_avg_billion_usd": round(flow_1d_b, 3),
        "flow_5d_total_krw": flow_5d_krw,
        "position_scale": position_scale,
        "thresholds": {
            "green_to_yellow": THRESH_GREEN_TO_YELLOW,
            "yellow_to_red": THRESH_YELLOW_TO_RED,
            "red_extreme": THRESH_RED_EXTREME,
        },
        "color": color,
        "emoji": emoji,
        "note": full_note,
        "history": new_history,
        "auto_update_pending": False,
        "source": source_label,
    }

    data["regime"] = new_regime

    if args.dry_run:
        log("DRY-RUN — 파일 쓰지 않음")
        print(json.dumps(new_regime, ensure_ascii=False, indent=4))
        return 0

    out_text = json.dumps(data, ensure_ascii=False, indent=2)
    if not out_text.endswith("\n"):
        out_text += "\n"
    # 원본 형식 보존: Node.js fs.writeFileSync 가 쓰는 CRLF + indent=2
    # (LF + indent=4 로 쓰면 git diff 가 buy/sell 전체로 보임)
    out_bytes = out_text.replace("\n", "\r\n").encode("utf-8")
    SUPPLY_JSON.write_bytes(out_bytes)
    log(f"✅ {SUPPLY_JSON} 갱신 완료 (UTF-8 no-BOM, CRLF, indent=2, {len(out_bytes):,} bytes)")

    print(json.dumps({
        "ok": True,
        "as_of": today_str,
        "regime": regime,
        "direction": direction,
        "flow_1d_avg_billion_usd": round(flow_1d_b, 3),
        "flow_5d_total_krw": flow_5d_krw,
        "position_scale": position_scale,
        "emoji": emoji,
        "source": source_label,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        log(f"❌ 실패: {type(e).__name__}: {e}")
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        sys.exit(1)
