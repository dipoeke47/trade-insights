import Link from "next/link";
import { BacktestRunner } from "@/components/backtest-runner";
import { ThemeToggle } from "@/components/theme-toggle";
import { LeaderboardTable, SurvivorsTable, SwingTable } from "@/components/backtest-tables";
import { signed, toneClass } from "@/lib/format";
import { APP_NAME } from "@/lib/app";
import type { RankedReport, OptimizeReport, SwingReport } from "@/lib/backtest/types";
import rankedJson from "@/lib/backtest/ranked.json";
import optimizedJson from "@/lib/backtest/optimized.json";
import swingJson from "@/lib/backtest/swing.json";

const ranked = rankedJson as unknown as RankedReport;
const optimized = optimizedJson as unknown as OptimizeReport;
const swing = swingJson as unknown as SwingReport;

export const metadata = { title: `${APP_NAME} — Strategy Backtester` };

// Concrete "playbook" cards — the single best credit and best cash-legal
// (non-credit) configs distilled from the full search, with trade-level detail.
const PLAYBOOK = {
  credit: {
    title: "Best overall — Credit spread",
    needs: "needs spread / Level-3 approval",
    lines: [
      ["Instrument", "IWM (Russell 2000 ETF) — 0DTE"],
      ["Strategy", "Vertical credit spread (bull-put when leaning up, bear-call when down)"],
      ["Entry filter", "MACD + EMA-cross must agree (skips ~⅔ of days — selective)"],
      ["Best account", "$1,000 · risk ~50% per trade"],
      ["Per trade", "≈ $440 collateral (2–3 spreads, each ~$3–5 wide)"],
      ["When to enter", "11:00 AM ET, only on agreement days"],
      ["When to exit", "let it decay to near max profit · stop if down 60% of credit · force-close 3:55 PM"],
    ],
    stats: "≈ 81% win days · Sharpe 0.78 · worst drawdown −22% · ~$100/day modeled",
    tone: "pos" as const,
  },
  nonCredit: {
    title: "Best cash-legal — Long call/put (directional)",
    needs: "tradeable today, but NO durable edge",
    lines: [
      ["Instrument", "IWM — 0DTE"],
      ["Strategy", "Buy 1 ATM call (lean up) or put (lean down)"],
      ["Best account", "$1,000 · risk ~25% per trade"],
      ["Per trade", "≈ $195 (1–2 contracts ~$115 each)"],
      ["When to enter", "9:45 AM ET"],
      ["When to exit", "+75% profit · −40% stop · force-close 3:55 PM"],
    ],
    stats: "≈ 43% win (coin-flip) · Sharpe 0.21 · worst drawdown −52% · ~$30/day modeled",
    tone: "warn" as const,
  },
};

export default function BacktestPage() {
  const top = ranked.ranked;
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

      {/* How to read this */}
      <details className="group mb-6 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4" open>
        <summary className="cursor-pointer list-none text-sm font-medium text-zinc-200">
          📖 How to read this page <span className="text-xs text-zinc-500">(click to collapse)</span>
        </summary>
        <ul className="mt-3 space-y-2 text-sm text-zinc-400">
          <li><strong className="text-zinc-200">The golden rule:</strong> a big <em>$/day</em> means nothing if <em>Max DD</em> (max drawdown — the worst peak-to-trough loss) is bigger than the account. That&apos;s a strategy that &ldquo;made money&rdquo; on paper but blew up first.</li>
          <li><strong className="text-zinc-200">$/day vs %/day:</strong> dollars favor bigger accounts; <em>%/day</em> (return on the account) compares $100 / $500 / $1,000 fairly.</li>
          <li><strong className="text-zinc-200">Win</strong> = share of days that finished green. <strong className="text-zinc-200">Sharpe</strong> = consistency (higher = steadier, not lumpy). <strong className="text-zinc-200">PF</strong> (profit factor) = $ won ÷ $ lost (&gt;1 = profitable). <strong className="text-zinc-200">n</strong> = number of trades (small n = treat as noise).</li>
          <li><strong className="text-zinc-200">Flags:</strong> <span className="text-pos">cash-OK</span> = tradeable in a cash account; <span className="text-warn">spread</span> = needs spread/Level-3 approval; <span className="text-warn">over&nbsp;$1k</span> = doesn&apos;t fit the account; <span className="text-warn">low-n</span> = too few trades to trust.</li>
          <li><strong className="text-zinc-200">Lotto vs Directional:</strong> both buy a single call/put. <em>Directional</em> buys <strong>at-the-money</strong> (~50/50, moves dollar-for-dollar). <em>Lotto</em> buys <strong>out-of-the-money</strong> — cheaper, higher payoff, lower win rate (a longer-shot bet).</li>
          <li><strong className="text-zinc-200">Data:</strong> 60 trading days (~3 months) of 5-minute bars, same window for every strategy. Option prices are <em>modeled</em> (no free real option data), so dollars are approximate — best for <em>ranking</em>, not as a profit promise. <strong className="text-zinc-200">Tip:</strong> click any column header to sort.</li>
        </ul>
      </details>

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

      {/* Strategy playbook — the two concrete recommendations */}
      <section className="mb-7">
        <h2 className="mb-1 text-lg font-semibold">Strategy playbook — the two to know</h2>
        <p className="mb-3 text-xs text-zinc-500">
          The single best config in each camp, distilled from the full search, with trade-level detail.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {[PLAYBOOK.credit, PLAYBOOK.nonCredit].map((p) => (
            <div key={p.title}
              className={`rounded-xl border p-4 ${p.tone === "pos" ? "border-emerald-700/40 bg-emerald-900/10" : "border-amber-600/30 bg-amber-500/5"}`}>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-zinc-100">{p.title}</h3>
                <span className={`text-[10px] uppercase tracking-wide ${p.tone === "pos" ? "text-pos" : "text-warn"}`}>{p.needs}</span>
              </div>
              <dl className="mt-2 space-y-1 text-xs">
                {p.lines.map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <dt className="w-24 shrink-0 text-zinc-500">{k}</dt>
                    <dd className="text-zinc-300">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className={`mt-2 border-t pt-2 text-xs ${p.tone === "pos" ? "border-emerald-800/40 text-pos" : "border-amber-700/30 text-warn"}`}>{p.stats}</p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-zinc-600">
          The cash-legal long is shown for completeness — its ~43% win rate is a coin flip; it&apos;s a leveraged bet
          on market direction, not a proven edge. The real edge is the credit spread.
        </p>
      </section>

      {/* Multi-day swing results */}
      <section className="mb-7">
        <h2 className="mb-1 text-lg font-semibold">Multi-day swing (held to expiry) — the more trustworthy test</h2>
        <p className="mb-3 text-xs text-zinc-500">
          Positions held across days to expiration, on <strong>~2 years of daily data</strong> (up to 500 trades).
          The exit payoff is the <em>real</em> underlying price at expiry — only the entry premium is modeled — so this
          is far more reliable than the 60-day intraday tests. <span className="text-pos">Green capital</span> = fits a $1k account.
          Sorted by Ret/DD; click to re-sort.
        </p>
        <SwingTable rows={swing.results} />
        <p className="mt-2 text-xs text-zinc-600">
          Premium-selling held to expiry wins 75–90% of the time — the real edge. But credit spreads/iron condors need
          spread approval, and ETF cash-secured puts need $23k–62k collateral; only cheap-name CSPs and overnight shares
          fit $1k. Premium selling is &ldquo;win often, lose big rarely&rdquo; — the ~2yr window is mostly calm/up.
        </p>
      </section>

      {/* Out-of-sample optimizer results */}
      <section className="mb-7">
        <h2 className="mb-1 text-lg font-semibold">Out-of-sample survivors (intraday)</h2>
        <p className="mb-3 text-xs text-zinc-500">
          Each config tuned on the first 65% of days, then scored on the held-out last 35%.
          &ldquo;Robust&rdquo; = profitable in <em>both</em> windows (resists curve-fitting). {robust.length} of {optimized.configs.length} strategy slots produced a robust config. Click headers to sort.
        </p>
        <SurvivorsTable rows={robust} />
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
          Click any column header to re-sort.
        </p>
        <LeaderboardTable rows={top} />
        <p className="mt-3 text-xs text-zinc-600">{ranked.methodology}</p>
      </section>
    </div>
  );
}
