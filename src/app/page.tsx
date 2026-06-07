import { getProvider } from "@/lib/broker";
import { AreaChart, BarChart } from "@/components/charts";
import { usd, pct, signed, toneClass } from "@/lib/format";
import { APP_NAME, APP_TAGLINE } from "@/lib/app";

export default async function Dashboard() {
  const provider = getProvider();
  const data = await provider.getDashboard();
  const { portfolio: p, positions, orders, pnlSeries, dailyTrades } = data;
  const maxDrawdown = Math.min(...pnlSeries.map((d) => d.drawdownPct));

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8">
      {/* Header */}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{APP_NAME}</h1>
          <p className="text-sm text-zinc-400">{APP_TAGLINE}</p>
        </div>
        <span className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300">
          {data.account.name} · {data.account.type}
        </span>
      </header>

      {data.source === "demo" && (
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <strong>Demo data.</strong> Connect a broker to see your real
          portfolio — set Robinhood credentials in <code>.env.local</code>.
        </div>
      )}

      {/* KPI cards */}
      <section className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Equity" value={usd(p.equity)} />
        <Kpi label="Day P/L" value={signed(p.dayPnl)} sub={pct(p.dayPnlPct)} tone={p.dayPnl} />
        <Kpi label="Total P/L" value={signed(p.totalPnl)} sub={pct(p.totalPnlPct)} tone={p.totalPnl} />
        <Kpi label="Buying Power" value={usd(p.buyingPower)} />
      </section>

      {/* Charts */}
      <section className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card title="Equity curve" subtitle="90 days">
          <AreaChart values={pnlSeries.map((d) => d.equity)} />
        </Card>
        <Card title="Drawdown" subtitle={`max ${maxDrawdown.toFixed(2)}%`}>
          <AreaChart
            values={pnlSeries.map((d) => d.drawdownPct)}
            stroke="#fb7185"
            fill="rgba(251,113,133,0.12)"
            baselineZero
          />
        </Card>
      </section>

      <section className="mb-6 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Daily trades" subtitle="last 30 days">
            <BarChart values={dailyTrades.map((d) => d.count)} />
          </Card>
        </div>
        {/* Agentic copilot — a view within the dashboard (Phase 3) */}
        <Card title="AI Copilot" subtitle="agentic · coming soon">
          <ul className="space-y-2 text-sm text-zinc-300">
            <li>• &ldquo;Review my open orders&rdquo;</li>
            <li>• &ldquo;What&rsquo;s driving today&rsquo;s P/L?&rdquo;</li>
            <li>• &ldquo;Rebalance toward my target weights&rdquo;</li>
          </ul>
          <p className="mt-3 text-xs text-zinc-500">
            Powered by the Anthropic API + Robinhood&rsquo;s agent MCP.
          </p>
        </Card>
      </section>

      {/* Positions */}
      <Card title="Positions" subtitle={`${positions.length} holdings`}>
        <Table
          head={["Symbol", "Qty", "Avg cost", "Last", "Mkt value", "Unrealized P/L"]}
          rows={positions.map((pos) => [
            <span key="s" className="font-medium">{pos.symbol}</span>,
            pos.qty,
            usd(pos.avgCost, 2),
            usd(pos.lastPrice, 2),
            usd(pos.marketValue),
            <span key="u" className={toneClass(pos.unrealizedPnl)}>
              {signed(pos.unrealizedPnl)} ({pct(pos.unrealizedPnlPct)})
            </span>,
          ])}
        />
      </Card>

      {/* Orders */}
      <div className="mt-6">
        <Card title="Recent orders" subtitle={`${orders.length} orders`}>
          <Table
            head={["Date", "Symbol", "Side", "Qty", "Price", "Status"]}
            rows={orders.map((o) => [
              new Date(o.createdAt).toLocaleDateString("en-US"),
              <span key="s" className="font-medium">{o.symbol}</span>,
              <span key="d" className={o.side === "buy" ? "text-emerald-400" : "text-rose-400"}>
                {o.side.toUpperCase()}
              </span>,
              o.qty,
              usd(o.price, 2),
              <span key="st" className="text-zinc-400">{o.status}</span>,
            ])}
          />
        </Card>
      </div>

      <footer className="mt-10 text-center text-xs text-zinc-600">
        {APP_NAME} · demo build · data source: {data.source}
      </footer>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: number;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      {sub && <div className={`text-sm ${tone !== undefined ? toneClass(tone) : "text-zinc-400"}`}>{sub}</div>}
    </div>
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

function Table({
  head,
  rows,
}: {
  head: string[];
  rows: React.ReactNode[][];
}) {
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
