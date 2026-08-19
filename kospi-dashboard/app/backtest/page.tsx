import { getSummary, fmtPct, fmtSharpe } from "@/lib/data";
import BacktestChart from "@/components/BacktestChart";

export const dynamic = "force-static";
export const metadata = { title: "Backtest · KOSPI 200" };

export default function BacktestPage() {
  const s = getSummary();
  const t1 = s.T1_train_test_excess;
  const t2 = s.T2_weight_stability;
  const t3 = s.T3_regularization;
  const t4 = s.T4_factor_count;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Backtest & Overfit Tests</h1>
        <p className="text-sm text-ink-dim">
          13팩터 모델의 train (2020-22) / test (2023-25) 성과 + 4종 overfit 진단
        </p>
      </header>

      {/* T1: train/test excess */}
      <section className="rounded-lg border border-gray-800 bg-bg-card p-5">
        <h2 className="mb-3 text-lg font-semibold">T1 · Train vs Test excess</h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <KPI label="Train excess (CAGR)" value={fmtPct(t1.train_excess_cagr)} />
          <KPI label="Test excess (CAGR)" value={fmtPct(t1.test_excess_cagr)} accent />
          <KPI
            label="Overfit ratio"
            value={t1.overfit_ratio ? t1.overfit_ratio.toFixed(2) + "x" : "—"}
            verdict={t1.overfit_ratio && t1.overfit_ratio < 2 ? "good" : "warn"}
          />
        </div>
        <p className="mt-3 text-sm text-ink-dim">
          {t1.overfit_ratio && t1.overfit_ratio < 2
            ? "✅ Train과 Test excess가 거의 동일 → 과적합 없음, 진짜 signal"
            : "⚠️ Train excess가 Test보다 훨씬 큼 → 과적합 의심"}
        </p>
      </section>

      {/* T2: weight stability */}
      <section className="rounded-lg border border-gray-800 bg-bg-card p-5">
        <h2 className="mb-3 text-lg font-semibold">T2 · Weight stability</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <KPI
            label="Sign agreement"
            value={`${t2.sign_agreement_pct.toFixed(0)}% (${t2.sign_agreement})`}
            verdict={t2.sign_agreement_pct >= 70 ? "good" : t2.sign_agreement_pct >= 50 ? "warn" : "bad"}
          />
        </div>
        <p className="mt-3 text-sm text-ink-dim">
          train을 1st half / 2nd half로 나눠 각 팩터 β 부호가 일치하는지. ≥70% 안정, 50-70% 보통.
        </p>
      </section>

      {/* T3: regularization */}
      <section className="rounded-lg border border-gray-800 bg-bg-card p-5">
        <h2 className="mb-3 text-lg font-semibold">T3 · OLS vs Ridge vs LASSO</h2>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>모델</th>
                <th className="text-right">Train CAGR</th>
                <th className="text-right">Test CAGR</th>
                <th className="text-right">Train Sharpe</th>
                <th className="text-right">Test Sharpe</th>
                <th>해석</th>
              </tr>
            </thead>
            <tbody>
              <ModelRow name="OLS (no reg)" {...t3.OLS} />
              <ModelRow name="Ridge (α=1)" {...t3.Ridge} />
              <ModelRow name="LASSO (α=.001)" {...t3.LASSO} />
            </tbody>
          </table>
        </div>
        {t3.LASSO_zeroed_factors.length > 0 && (
          <p className="mt-3 text-sm text-ink-dim">
            LASSO가 0으로 보낸 팩터 ({t3.LASSO_zeroed_factors.length}개):{" "}
            <span className="font-mono">{t3.LASSO_zeroed_factors.join(", ")}</span>
          </p>
        )}
      </section>

      {/* T4: factor count */}
      <section className="rounded-lg border border-gray-800 bg-bg-card p-5">
        <h2 className="mb-3 text-lg font-semibold">T4 · 팩터 수 vs Test 성능</h2>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>세트</th>
                <th className="text-right">팩터 수</th>
                <th className="text-right">Train Sharpe</th>
                <th className="text-right">Test Sharpe</th>
                <th>판정</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(t4).map(([name, v]: [string, any]) => (
                <tr key={name}>
                  <td className={name === s.best_test_set ? "text-accent-up font-semibold" : ""}>{name}</td>
                  <td className="num text-right">{v.train && v.train.Sharpe ? "—" : "—"}</td>
                  <td className="num text-right">{fmtSharpe(v.train.Sharpe)}</td>
                  <td className="num text-right">{fmtSharpe(v.test.Sharpe)}</td>
                  <td className="text-xs text-ink-dim">
                    {name === s.best_test_set ? "⭐ 최고" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 1차 vs 2차 */}
      <section className="rounded-lg border border-gray-800 bg-bg-card p-5">
        <h2 className="mb-3 text-lg font-semibold">1차 vs 2차 회귀 비교</h2>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>라운드</th>
                <th>팩터 구성</th>
                <th className="text-right">Train excess</th>
                <th className="text-right">Test excess</th>
                <th className="text-right">Overfit ratio</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>1차</td>
                <td className="text-ink-dim">5 가격 팩터</td>
                <td className="num text-right up">+17.92%</td>
                <td className="num text-right up">+2.04%</td>
                <td className="num text-right down">8.78x</td>
              </tr>
              <tr>
                <td className="text-accent-blue font-semibold">2차</td>
                <td className="text-ink-dim">5 가격 + 8 펀더멘털</td>
                <td className="num text-right up">+18.92%</td>
                <td className="num text-right up">+18.66%</td>
                <td className="num text-right up">1.01x ⭐</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* 차트 placeholder (실제 시계열 데이터는 별도 JSON 필요) */}
      <section className="rounded-lg border border-gray-800 bg-bg-card p-5">
        <h2 className="mb-3 text-lg font-semibold">누적 수익률 (train / test)</h2>
        <p className="text-xs text-ink-faint">
          ※ 02_factors_regression.py가 생성한 일별 누적 수익률 시계열을 별도 JSON으로 추가 시 차트 표시 가능.
          현재는 정적 summary 표시.
        </p>
        <BacktestChart />
      </section>
    </div>
  );
}

function KPI({ label, value, accent, verdict }: { label: string; value: string; accent?: boolean; verdict?: "good" | "warn" | "bad" }) {
  const verdictCls = verdict === "good" ? "up" : verdict === "warn" ? "text-amber-400" : verdict === "bad" ? "down" : "";
  return (
    <div className="rounded border border-gray-800 bg-bg-elev p-3">
      <div className="text-xs text-ink-faint">{label}</div>
      <div className={`mt-1 text-2xl font-semibold num ${accent ? "text-accent-blue" : verdictCls}`}>{value}</div>
    </div>
  );
}

function ModelRow({ name, train_Sharpe, test_Sharpe, test_CAGR }: any) {
  return (
    <tr>
      <td className="font-mono text-sm">{name}</td>
      <td className="num text-right">{test_CAGR ? (test_CAGR * 100).toFixed(1) + "%" : "—"}</td>
      <td className="num text-right">{test_CAGR ? (test_CAGR * 100).toFixed(1) + "%" : "—"}</td>
      <td className="num text-right">{train_Sharpe?.toFixed(2)}</td>
      <td className="num text-right">{test_Sharpe?.toFixed(2)}</td>
      <td className="text-xs text-ink-dim">{test_Sharpe > 2 ? "✅" : ""}</td>
    </tr>
  );
}
