import { Suspense } from "react";
import Link from "next/link";
import { getProvider } from "@/lib/broker";
import { AreaChart, BarChart } from "@/components/charts";
import { RangeSelector } from "@/components/range-selector";
import { RefreshButton } from "@/components/refresh-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { TransactionsTable } from "@/components/transactions-table";
import {
  anchorDate,
  coverageStart,
  deriveEvents,
  deriveTransactions,
  resolveRange,
  windowView,
  type RangePreset,
  type SymbolPnl,
} from "@/lib/window";
import { usd, pct, signed, toneClass, dateTime, dateOnly } from "@/lib/format";
import { APP_NAME, APP_TAGLINE } from "@/lib/app";

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; range?: string; from?: string; to?: string }>;
}) {
  const { account, range, from, to } = await searchParams;
  const provider = getProvider();
  const [accounts, data] = await Promise.all([
    provider.listAccounts(),
    provider.getDashboard(account),
  ]);

  const { portfolio: p, positions } = data;
  const isReal = data.source === "robinhood";

  // Resolve the selected range and window all activity-derived data to it.
  const anchor = anchorDate(deriveTransactions(data), deriveEvents(data));
  const rng = resolveRange((range as RangePreset) || "ALL", anchor, from, to);
  const view = windowView(data, rng.from, rng.to);
  const hasHistory = view.pnlSeries.length > 0;
  const rangeDates = `${rng.from.toLocaleDateString("en-US")} – ${rng.to.toLocaleDateString("en-US")}`;

  // Snapshot provenance: when the data was pulled, and how far back it reaches.
  const pulledAt = data.generatedAt ? dateTime(data.generatedAt) : null;
  const coverageFrom = coverageStart(data);

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8">
      {/* Header */}
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{APP_NAME}</h1>
          <p className="text-sm text-zinc-400">{APP_TAGLINE}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-3">
            <Link
              href="/backtest"
              className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition hover:text-zinc-100"
            >
              📊 Backtester
            </Link>
            <ThemeToggle />
            {isReal && <RefreshButton />}
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
                isReal ? "border-emerald-500/40 text-pos" : "border-zinc-700 text-zinc-300"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${isReal ? "bg-emerald-400" : "bg-zinc-500"}`} />
              {isReal ? "Live · Robinhood" : "Demo data"}
            </span>
          </div>
          {pulledAt && (
            <span className="text-xs text-zinc-500" title={data.generatedAt}>
              Snapshot pulled {pulledAt}
            </span>
          )}
        </div>
      </header>

      {/* Account switcher */}
      {accounts.length > 1 && (
        <nav className="mb-4 flex flex-wrap gap-2">
          {accounts.map((a) => {
            const active = a.id === data.account.id;
            return (
              <Link
                key={a.id}
                href={`/?account=${a.id}`}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  active
                    ? "border-emerald-500/50 bg-emerald-500/10 text-pos"
                    : "border-zinc-700 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {a.name}
              </Link>
            );
          })}
        </nav>
      )}

      {/* Global date-range control — re-scopes every activity panel below */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
        <Suspense fallback={<div className="h-7" />}>
          <RangeSelector active={rng.preset} />
        </Suspense>
        <div className="text-xs text-zinc-500">
          Showing <span className="text-zinc-300">{rng.label}</span> · {rangeDates}
          {coverageFrom && (
            <>
              {" "}
              · history back to{" "}
              <span className="text-zinc-300">{dateOnly(coverageFrom)}</span>
            </>
          )}
        </div>
      </div>

      {!isReal && (
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-warn">
          <strong>Demo data.</strong> Connect a broker to see your real portfolio —
          drop a Robinhood snapshot at <code>.rh-snapshot.local.json</code>.
        </div>
      )}

      {/* KPI cards — realized P&L + trades are windowed; balances are current */}
      <section className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          label="Realized P/L"
          tag={rng.label}
          value={signed(view.realizedTotal)}
          tone={view.realizedTotal}
        />
        <Kpi
          label="Trades"
          tag={rng.label}
          value={String(view.tradeCount)}
          sub={`${view.stockTradeCount} stock · ${view.optionTradeCount} opt`}
        />
        <Kpi
          label="Account value"
          tag="current"
          value={usd(p.equity)}
          sub={p.optionsValue ? `${usd(p.optionsValue)} options` : undefined}
        />
        <Kpi label="Buying power" tag="current" value={usd(p.buyingPower)} />
      </section>

      {/* Charts */}
      <section className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card title="Realized P&L" subtitle={rng.label}>
          {hasHistory ? (
            <AreaChart
              values={view.pnlSeries.map((d) => d.equity)}
              labels={view.pnlSeries.map((d) => d.date)}
              format="usd"
              baselineZero
            />
          ) : (
            <Empty>No realized P&amp;L in this range.</Empty>
          )}
        </Card>
        <Card title="Drawdown" subtitle={hasHistory ? `max ${view.maxDrawdown.toFixed(2)}%` : "—"}>
          {hasHistory ? (
            <AreaChart
              values={view.pnlSeries.map((d) => d.drawdownPct)}
              labels={view.pnlSeries.map((d) => d.date)}
              format="pct"
              stroke="#fb7185"
              fill="rgba(251,113,133,0.12)"
              baselineZero
            />
          ) : (
            <Empty>No drawdown to show.</Empty>
          )}
        </Card>
      </section>

      <section className="mb-6 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Daily trades" subtitle={rng.label}>
            {view.dailyTrades.length ? (
              <BarChart
                values={view.dailyTrades.map((d) => d.count)}
                labels={view.dailyTrades.map((d) => d.date)}
              />
            ) : (
              <Empty>No trades in this range.</Empty>
            )}
          </Card>
        </div>
        <Card title="AI Copilot" subtitle="agentic · coming soon">
          <ul className="space-y-2 text-sm text-zinc-300">
            <li>• &ldquo;Review my open orders&rdquo;</li>
            <li>• &ldquo;What&rsquo;s driving this period&rsquo;s P/L?&rdquo;</li>
            <li>• &ldquo;Rebalance toward my target weights&rdquo;</li>
          </ul>
          <p className="mt-3 text-xs text-zinc-500">
            Powered by the Anthropic API + Robinhood&rsquo;s agent MCP.
          </p>
        </Card>
      </section>

      {/* Realized P&L by symbol — winners & losers within the range */}
      <div className="mb-6">
        <Card title="Realized P&L by symbol" subtitle={rng.label}>
          {view.bySymbol.length ? (
            <div className="grid gap-6 sm:grid-cols-2">
              <SymbolList
                title="Top winners"
                rows={view.bySymbol.filter((s) => s.realized > 0).slice(0, 5)}
              />
              <SymbolList
                title="Top losers"
                rows={view.bySymbol.filter((s) => s.realized < 0).slice(-5).reverse()}
              />
            </div>
          ) : (
            <Empty>No realized P&amp;L in this range.</Empty>
          )}
        </Card>
      </div>

      {/* Holdings — point-in-time, not affected by the range */}
      <Card
        title="Holdings"
        subtitle={`current · ${positions.length + (p.optionsValue ? 1 : 0)} holdings`}
      >
        {positions.length || p.optionsValue ? (
          <Table
            head={["Symbol", "Qty", "Avg cost", "Last", "Mkt value", "Unrealized P/L"]}
            rows={[
              ...positions.map((pos) => [
                <span key="s" className="font-medium">{pos.symbol}</span>,
                pos.qty,
                usd(pos.avgCost, 2),
                usd(pos.lastPrice, 2),
                usd(pos.marketValue),
                <span key="u" className={toneClass(pos.unrealizedPnl)}>
                  {signed(pos.unrealizedPnl)} ({pct(pos.unrealizedPnlPct)})
                </span>,
              ]),
              ...(p.optionsValue
                ? [[
                    <span key="o" className="font-medium">
                      Options{" "}
                      <span className="text-xs font-normal text-zinc-500">aggregate</span>
                    </span>,
                    "—", "—", "—",
                    usd(p.optionsValue),
                    <span key="ou" className="text-zinc-500">n/a</span>,
                  ]]
                : []),
            ]}
          />
        ) : (
          <Empty>No open positions.</Empty>
        )}
        {p.optionsValue ? (
          <p className="mt-3 text-xs text-zinc-500">
            Options shown as aggregate market value — per-contract detail isn’t
            exposed by the Robinhood agent API.
          </p>
        ) : null}
      </Card>

      {/* Transactions — windowed to the selected range; filtered + paged client-side */}
      <div className="mt-6">
        <Card
          title="Transactions"
          subtitle={`${rng.label} · ${view.stockTradeCount} stock · ${view.optionTradeCount} options`}
        >
          <TransactionsTable transactions={view.transactions} />
        </Card>
      </div>

      <footer className="mt-10 text-center text-xs text-zinc-600">
        {APP_NAME} · {isReal ? "live snapshot" : "demo build"} · {rng.label} · data
        source: {data.source}
      </footer>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
  tag,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: number;
  tag?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
        {tag && <div className="text-[10px] uppercase tracking-wide text-zinc-600">{tag}</div>}
      </div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      {sub && (
        <div className={`text-sm ${tone !== undefined ? toneClass(tone) : "text-zinc-400"}`}>{sub}</div>
      )}
    </div>
  );
}

function SymbolList({ title, rows }: { title: string; rows: SymbolPnl[] }) {
  return (
    <div>
      <div className="mb-2 text-xs uppercase tracking-wide text-zinc-500">{title}</div>
      {rows.length ? (
        <ul className="space-y-1.5">
          {rows.map((s) => (
            <li key={s.symbol} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <span className="font-medium">{s.symbol}</span>
                {s.assetType === "option" && (
                  <span className="text-[10px] uppercase text-violet-300">opt</span>
                )}
                <span className="text-xs text-zinc-600">
                  {s.trades} {s.trades === 1 ? "trade" : "trades"}
                </span>
              </span>
              <span className={`tabular-nums ${toneClass(s.realized)}`}>{signed(s.realized)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-600">None.</p>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-24 items-center justify-center text-sm text-zinc-500">{children}</div>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-zinc-200">{title}</h2>
        {subtitle && <span className="text-xs text-zinc-500">{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-zinc-500">
            {head.map((h) => (
              <th key={h} className="pb-2 pr-4 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {rows.map((row, i) => (
            <tr key={i} className="text-zinc-200">
              {row.map((cell, j) => (
                <td key={j} className="py-2 pr-4 tabular-nums">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
