import Link from "next/link";
import { BacktestRunner } from "@/components/backtest-runner";
import { ThemeToggle } from "@/components/theme-toggle";
import { signed, usd, toneClass } from "@/lib/format";
import { APP_NAME } from "@/lib/app";
import type { RankedReport, OptimizeReport, Summary } from "@/lib/backtest/types";
import rankedJson from "@/lib/backtest/ranked.json";
import optimizedJson from "@/lib/backtest/optimized.json";

const ranked = rankedJson as unknown as RankedReport;
const optimized = optimizedJson as unknown as OptimizeReport;

export const metadata = { title: `${APP_NAME} — Strategy Backtester` };

function Badge({ children, tone }: { children: React.ReactNode; tone: "ok" | "warn" | "muted" }) {
  const cls = tone === "ok" ? "border-emerald-500/40 text-pos"
    : tone === "warn" ? "border-amber-500/40 text-warn"
    : "border-zinc-700 text-zinc-400";
  return <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${cls}`}>{children}</span>;
}

function Row({ s }: { s: Summary }) {
  return (
    <tr className="border-t border-zinc-800/70 hover:bg-zinc-900/40">
      <td className="py-2 pr-2 text-zinc-500 tabular-nums">{s.rank}</td>
      <td className="py-2 pr-2 font-medium text-zinc-200">{s.symbol}</td>
      <td className="py-2 pr-2 text-zinc-300">{s.strategy_name}</td>
      <td className="py-2 pr-2 text-right tabular-nums text-zinc-400">{usd(s.account_size ?? 0)}</td>
      <td className={`py-2 pr-2 text-right tabular-nums font-medium ${toneClass(s.avg_daily_pnl ?? 0)}`}>{signed(s.avg_daily_pnl ?? 0)}</td>
      <td className="py-2 pr-2 text-right tabular-nums text-zinc-300">{Math.round((s.win_rate ?? 0) * 100)}%</td>
      <td className={`py-2 pr-2 text-right tabular-nums ${toneClass(s.daily_sharpe ?? 0)}`}>{(s.daily_sharpe ?? 0).toFixed(2)}</td>
      <td className="py-2 pr-2 text-right tabular-nums text-zinc-400">{s.profit_factor != null ? s.profit_factor.toFixed(2) : "∞"}</td>
      <td className="py-2 pr-2 text-right tabular-nums text-zinc-500">{s.trades}</td>
      <td className="py-2 pr-2">
        <div className="flex flex-wrap gap-1">
          {s.cash_account_ok ? <Badge tone="ok">cash-OK</Badge> : <Badge tone="warn">spread</Badge>}
          {s.affordable === false && <Badge tone="warn">over $1k</Badge>}
          {s.low_sample && <Badge tone="warn">low-n</Badge>}
        </div>
      </td>
    </tr>
  );
}

export default function BacktestPage() {
  const top = ranked.ranked.slice(0, 20);
  const robust = optimized.configs
    .filter((c) => c.best_robust)
    .map((c) => c.best_robust!)
    .sort((a, b) => b.test_avg_daily - a.test_avg_daily);
  const cashLegalRobust = robust.filter((c) => c.cash_account_ok);

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Intraday Options Backtester</h1>
          <p className="text-sm text-zinc-400">
            Same-day open/close strategies ranked by consistent daily profitability · {ranked.sample_trading_days} trading days · {ranked.interval} bars
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/" className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition hover:text-zinc-100">
            ← Dashboard
          </Link>
        </div>
      </header>

      {/* Honesty banner */}
      <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-warn/90">
        <p className="font-medium text-warn">⚠ Read this first — what these numbers are (and aren&apos;t)</p>
        <p className="mt-1.5 text-warn/80">
          Free historical <em>option</em> prices don&apos;t exist, so options here are <strong>modeled</strong> with
          Black-Scholes on <strong>real</strong> intraday underlying data, with implied vol anchored to the live VIX
          level (SPY ≈ 19%, scaled up per symbol). Fills, slippage, and fees are modeled — these are <strong>not real
          market quotes</strong>. Treat results as good for <em>ranking strategies against each other</em>, approximate
          for absolute dollars, and <strong>never</strong> as a promise of future profit. Past-window edges routinely vanish live.
        </p>
      </div>

      {/* Best offer / recommendation */}
      <section className="mb-7">
        <h2 className="mb-2 text-lg font-semibold">The honest &ldquo;best offer&rdquo; for a $1k cash account</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Finding #1 — no free lunch</div>
            <p className="mt-1.5 text-sm text-zinc-300">
              Once options are priced at realistic IV, <strong>naive long-premium plays</strong> (buying calls/puts,
              straddles, strangles) are <strong>break-even to negative</strong> after theta + slippage. The earlier
              &ldquo;profitable straddle&rdquo; was a mispricing artifact — it disappears at fair IV.
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Finding #2 — the edge is in selling</div>
            <p className="mt-1.5 text-sm text-zinc-300">
              The only <strong>broadly out-of-sample-robust</strong> edge is <strong>selling defined-risk 0DTE credit
              spreads</strong> on SPY/QQQ (76–82% win days). But that needs <strong>spread approval</strong> — which a
              cash account doesn&apos;t have. So it&apos;s the recommendation <em>if</em> you upgrade approval, not today.
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Finding #3 — what you can do now</div>
            <p className="mt-1.5 text-sm text-zinc-300">
              Affordable + cash-legal winners are mostly <strong>leveraged directional</strong> longs — which is really
              a <strong>bet on market drift</strong> (it worked because this sample trended up), not a durable intraday
              edge. <strong>Paper-trade first.</strong> CSP/covered calls don&apos;t fit $1k (need sub-$10 stock).
            </p>
          </div>
        </div>

        {cashLegalRobust.length > 0 && (
          <div className="mt-3 rounded-xl border border-emerald-700/40 bg-emerald-900/10 p-4">
            <div className="text-xs uppercase tracking-wide text-pos">
              Best cash-account-legal config that survived the out-of-sample test
            </div>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
              <span className="font-semibold text-zinc-100">{cashLegalRobust[0].symbol} · {cashLegalRobust[0].strategy_name}</span>
              <span className="text-zinc-400">
                signal <b className="text-zinc-200">{String(cashLegalRobust[0].params.signal)}</b> ·
                target <b className="text-zinc-200">{Math.round(Number(cashLegalRobust[0].params.target_pct) * 100)}%</b> ·
                stop <b className="text-zinc-200">{Math.round(Number(cashLegalRobust[0].params.stop_pct) * 100)}%</b>
              </span>
              <span className={toneClass(cashLegalRobust[0].test_avg_daily)}>
                out-of-sample {signed(cashLegalRobust[0].test_avg_daily)}/day @ {Math.round(cashLegalRobust[0].test_win * 100)}% win
              </span>
            </div>
            <p className="mt-1.5 text-xs text-pos/60">
              Caveat: directional longs profit mostly from market drift; high variance; size down and paper-trade.
            </p>
          </div>
        )}
      </section>

      {/* Out-of-sample optimizer results */}
      <section className="mb-7">
        <h2 className="mb-1 text-lg font-semibold">Out-of-sample survivors</h2>
        <p className="mb-3 text-xs text-zinc-500">
          Each config tuned on the first 65% of days, then scored on the held-out last 35%.
          &ldquo;Robust&rdquo; = profitable in <em>both</em> windows (resists curve-fitting). {robust.length} of {optimized.configs.length} strategy slots produced a robust config.
        </p>
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2">Symbol</th><th className="px-3 py-2">Strategy</th>
                <th className="px-3 py-2">Best params</th>
                <th className="px-3 py-2 text-right">Train $/day</th>
                <th className="px-3 py-2 text-right">Test $/day</th>
                <th className="px-3 py-2 text-right">Test win</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {robust.map((c, i) => (
                <tr key={i} className="border-t border-zinc-800/70">
                  <td className="px-3 py-2 font-medium text-zinc-200">{c.symbol}</td>
                  <td className="px-3 py-2 text-zinc-300">{c.strategy_name}</td>
                  <td className="px-3 py-2 text-xs text-zinc-500">{String(c.params.signal)} · tgt {Math.round(Number(c.params.target_pct) * 100)}% · stop {Math.round(Number(c.params.stop_pct) * 100)}%</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${toneClass(c.train_avg_daily)}`}>{signed(c.train_avg_daily)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-medium ${toneClass(c.test_avg_daily)}`}>{signed(c.test_avg_daily)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-300">{Math.round(c.test_win * 100)}%</td>
                  <td className="px-3 py-2">{c.cash_account_ok ? <Badge tone="ok">cash-OK</Badge> : <Badge tone="warn">spread</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Interactive runner */}
      <section className="mb-7">
        <h2 className="mb-1 text-lg font-semibold">Run your own backtest</h2>
        <p className="mb-3 text-xs text-zinc-500">
          Tweak any parameter and run it live against real intraday data (local only — the public deploy shows the precomputed tables above).
        </p>
        <BacktestRunner />
      </section>

      {/* Full leaderboard */}
      <section>
        <h2 className="mb-1 text-lg font-semibold">Baseline leaderboard (default params)</h2>
        <p className="mb-3 text-xs text-zinc-500">
          Every strategy × symbol × account size at default settings, ranked by a daily-consistency score
          (daily Sharpe × green-day share × $/day, discounted for small samples + un-affordability + non-cash-legality).
        </p>
        <div className="overflow-x-auto rounded-xl border border-zinc-800 px-3">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="py-2 pr-2">#</th><th className="py-2 pr-2">Sym</th><th className="py-2 pr-2">Strategy</th>
                <th className="py-2 pr-2 text-right">Acct</th><th className="py-2 pr-2 text-right">$/day</th>
                <th className="py-2 pr-2 text-right">Win</th><th className="py-2 pr-2 text-right">Sharpe</th>
                <th className="py-2 pr-2 text-right">PF</th><th className="py-2 pr-2 text-right">n</th>
                <th className="py-2 pr-2">Flags</th>
              </tr>
            </thead>
            <tbody>{top.map((s) => <Row key={`${s.symbol}-${s.strategy}-${s.account_size}`} s={s} />)}</tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-zinc-600">{ranked.methodology}</p>
      </section>
    </div>
  );
}
