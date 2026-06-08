"use client";

// Interactive backtest runner: pick a strategy + params, POST to /api/backtest,
// render the modeled daily-P&L result. Live runs are local-only; on the public
// deploy the API 403s and we show that gracefully.

import { useState } from "react";
import { AreaChart } from "@/components/charts";
import { usd, signed, toneClass } from "@/lib/format";
import {
  STRATEGIES, SYMBOLS, ACCOUNT_SIZES, SIGNALS,
  type Summary, type RunRequest,
} from "@/lib/backtest/types";

const ENTRY_TIMES = [
  { v: 575, label: "9:35 AM" }, { v: 585, label: "9:45 AM" },
  { v: 600, label: "10:00 AM" }, { v: 630, label: "10:30 AM" },
  { v: 660, label: "11:00 AM" },
];
const EXIT_TIMES = [
  { v: 930, label: "3:30 PM" }, { v: 945, label: "3:45 PM" }, { v: 955, label: "3:55 PM" },
];

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-zinc-400">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-zinc-600">{hint}</span>}
    </label>
  );
}

const selectCls =
  "rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 focus:border-zinc-500 focus:outline-none";

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${tone ?? "text-zinc-100"}`}>{value}</div>
    </div>
  );
}

export function BacktestRunner({ initial }: { initial?: Partial<RunRequest> }) {
  const [req, setReq] = useState<RunRequest>({
    symbol: initial?.symbol ?? "SPY",
    strategy: initial?.strategy ?? "long_call_put",
    account_size: initial?.account_size ?? 1000,
    entry_minute: initial?.entry_minute ?? 585,
    time_exit_minute: initial?.time_exit_minute ?? 955,
    target_pct: initial?.target_pct ?? 0.5,
    stop_pct: initial?.stop_pct ?? 0.5,
    iv_multiplier: initial?.iv_multiplier ?? 1.2,
    signal: initial?.signal ?? "momentum",
  });
  const [result, setResult] = useState<Summary | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");

  const strat = STRATEGIES.find((s) => s.key === req.strategy);
  const set = <K extends keyof RunRequest>(k: K, v: RunRequest[K]) =>
    setReq((r) => ({ ...r, [k]: v }));

  const run = async () => {
    setState("loading");
    setError("");
    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setState("error");
        setError(data.error || "Backtest failed.");
        setResult(null);
        return;
      }
      setResult(data);
      setState("idle");
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : "Request failed.");
    }
  };

  const traded = result?.days?.filter((d) => d.traded) ?? [];
  const curve = result?.equity_curve ?? [];
  const labels = traded.map((d) => d.day);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Field label="Underlying">
          <select className={selectCls} value={req.symbol} onChange={(e) => set("symbol", e.target.value)}>
            {SYMBOLS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Strategy">
          <select className={selectCls} value={req.strategy} onChange={(e) => set("strategy", e.target.value)}>
            {STRATEGIES.map((s) => (
              <option key={s.key} value={s.key}>{s.name}{s.cashAccountOk ? "" : "  ⚠ spread"}</option>
            ))}
          </select>
        </Field>
        <Field label="Account size">
          <select className={selectCls} value={req.account_size} onChange={(e) => set("account_size", Number(e.target.value))}>
            {ACCOUNT_SIZES.map((a) => <option key={a} value={a}>{usd(a)}</option>)}
          </select>
        </Field>
        <Field label="Signal" hint={strat && !["long_call_put", "long_otm", "debit_spread", "credit_spread"].includes(strat.key) ? "ignored (non-directional)" : "direction filter"}>
          <select className={selectCls} value={req.signal} onChange={(e) => set("signal", e.target.value)}>
            {SIGNALS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Entry time">
          <select className={selectCls} value={req.entry_minute} onChange={(e) => set("entry_minute", Number(e.target.value))}>
            {ENTRY_TIMES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Exit time (force close)">
          <select className={selectCls} value={req.time_exit_minute} onChange={(e) => set("time_exit_minute", Number(e.target.value))}>
            {EXIT_TIMES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
          </select>
        </Field>
        <Field label={`Profit target (${Math.round((req.target_pct ?? 0) * 100)}%)`} hint="of premium basis">
          <input type="range" min={0.2} max={1.5} step={0.05} value={req.target_pct}
            onChange={(e) => set("target_pct", Number(e.target.value))} className="accent-emerald-500" />
        </Field>
        <Field label={`Stop loss (${Math.round((req.stop_pct ?? 0) * 100)}%)`} hint="of premium basis">
          <input type="range" min={0.2} max={2} step={0.05} value={req.stop_pct}
            onChange={(e) => set("stop_pct", Number(e.target.value))} className="accent-rose-500" />
        </Field>
        <Field label={`IV assumption (${(req.iv_multiplier ?? 1).toFixed(2)}× realized)`} hint="0DTE trades richer than VIX">
          <input type="range" min={0.9} max={1.6} step={0.05} value={req.iv_multiplier}
            onChange={(e) => set("iv_multiplier", Number(e.target.value))} className="accent-sky-500" />
        </Field>
      </div>

      {strat && (
        <p className="mt-3 text-xs text-zinc-500">
          {strat.blurb}
          {!strat.cashAccountOk && <span className="text-amber-400"> — backtest-only; needs spread/short approval you don&apos;t have in a cash account.</span>}
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button onClick={run} disabled={state === "loading"}
          className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50">
          {state === "loading" ? "Running…" : "▶ Run backtest"}
        </button>
        {state === "error" && <span className="text-xs text-rose-400">{error}</span>}
      </div>

      {result && result.trades > 0 && (
        <div className="mt-5 border-t border-zinc-800 pt-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Avg / day" value={signed(result.avg_daily_pnl ?? 0)} tone={toneClass(result.avg_daily_pnl ?? 0)} />
            <Stat label="Total P&L" value={signed(result.total_pnl ?? 0)} tone={toneClass(result.total_pnl ?? 0)} />
            <Stat label="Win rate" value={`${Math.round((result.win_rate ?? 0) * 100)}%`} />
            <Stat label="Daily Sharpe" value={(result.daily_sharpe ?? 0).toFixed(2)} tone={toneClass(result.daily_sharpe ?? 0)} />
            <Stat label="Profit factor" value={result.profit_factor != null ? result.profit_factor.toFixed(2) : "∞"} />
            <Stat label="Max drawdown" value={usd(result.max_drawdown ?? 0)} tone="text-rose-400" />
            <Stat label="Trades" value={`${result.trades}/${result.total_days ?? "?"}`} />
            <Stat label="Avg win" value={signed(result.avg_win ?? 0)} tone="text-emerald-400" />
            <Stat label="Avg loss" value={signed(result.avg_loss ?? 0)} tone="text-rose-400" />
            <Stat label="Contracts/day" value={(result.avg_units ?? 0).toFixed(1)} />
            <Stat label="Capital/day" value={usd(result.avg_capital_deployed ?? 0)} />
            <Stat label="Consistency" value={(result.score ?? 0).toFixed(2)} tone={toneClass(result.score ?? 0)} />
          </div>

          {result.low_sample && (
            <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
              ⚠ Low sample ({result.trades} trades) — these numbers are noise, not a real edge.
            </p>
          )}

          {curve.length > 1 && (
            <div className="mt-4">
              <div className="mb-1 text-xs text-zinc-500">Cumulative P&amp;L (sized to account, per trading day)</div>
              <AreaChart values={curve} labels={labels} format="usd" baselineZero
                stroke={(result.total_pnl ?? 0) >= 0 ? "#34d399" : "#fb7185"}
                fill={(result.total_pnl ?? 0) >= 0 ? "rgba(52,211,153,0.12)" : "rgba(251,113,133,0.12)"} />
            </div>
          )}

          {result.exit_mix && (
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-400">
              <span className="text-zinc-500">Exits:</span>
              {Object.entries(result.exit_mix).map(([k, v]) => (
                <span key={k} className="rounded border border-zinc-800 px-1.5 py-0.5">{k}: {v}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {result && result.trades === 0 && (
        <p className="mt-4 rounded-md border border-zinc-700 bg-zinc-900/50 px-3 py-2 text-sm text-zinc-300">
          No trades: {result.error ?? "signal never fired or unaffordable for this account size."}
        </p>
      )}
    </div>
  );
}
