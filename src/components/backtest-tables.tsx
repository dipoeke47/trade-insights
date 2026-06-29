"use client";

// Sortable leaderboard + out-of-sample survivor tables for the /backtest page.
// Receive plain serializable rows from the server page; columns (with their
// formatting/sort accessors) are defined here on the client.

import { SortableTable, type Col } from "@/components/sortable-table";
import { signed, usd, toneClass } from "@/lib/format";
import type { Summary, OptimizeCandidate } from "@/lib/backtest/types";

function Badge({ children, tone }: { children: React.ReactNode; tone: "ok" | "warn" }) {
  const cls = tone === "ok" ? "border-emerald-500/40 text-pos" : "border-amber-500/40 text-warn";
  return <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${cls}`}>{children}</span>;
}

export function LeaderboardTable({ rows }: { rows: Summary[] }) {
  const columns: Col<Summary>[] = [
    { key: "rank", label: "#", sort: (s) => s.rank ?? 999,
      cell: (s) => <span className="text-zinc-500 tabular-nums">{s.rank}</span> },
    { key: "symbol", label: "Sym", sort: (s) => s.symbol,
      cell: (s) => <span className="font-medium text-zinc-200">{s.symbol}</span> },
    { key: "strategy", label: "Strategy", sort: (s) => s.strategy_name,
      cell: (s) => <span className="text-zinc-300">{s.strategy_name}</span> },
    { key: "acct", label: "Acct", align: "right", sort: (s) => s.account_size ?? 0,
      cell: (s) => <span className="text-zinc-400">{usd(s.account_size ?? 0)}</span> },
    { key: "pnl", label: "$/day", align: "right", sort: (s) => s.avg_daily_pnl ?? 0,
      cell: (s) => <span className={`font-medium ${toneClass(s.avg_daily_pnl ?? 0)}`}>{signed(s.avg_daily_pnl ?? 0)}</span> },
    { key: "ret", label: "%/day", align: "right", sort: (s) => s.avg_daily_return_pct ?? 0,
      cell: (s) => <span className={toneClass(s.avg_daily_return_pct ?? 0)}>{(s.avg_daily_return_pct ?? 0).toFixed(1)}%</span> },
    { key: "win", label: "Win", align: "right", sort: (s) => s.win_rate ?? 0,
      cell: (s) => <span className="text-zinc-300">{Math.round((s.win_rate ?? 0) * 100)}%</span> },
    { key: "sharpe", label: "Sharpe", align: "right", sort: (s) => s.daily_sharpe ?? 0,
      cell: (s) => <span className={toneClass(s.daily_sharpe ?? 0)}>{(s.daily_sharpe ?? 0).toFixed(2)}</span> },
    { key: "dd", label: "Max DD", align: "right", sort: (s) => s.max_drawdown ?? 0,
      cell: (s) => <span className="text-neg" title="Worst peak-to-trough loss over the test (sized $)">{usd(s.max_drawdown ?? 0)}</span> },
    { key: "retdd", label: "Ret/DD", align: "right", sort: (s) => s.return_dd ?? -99,
      cell: (s) => <span className={toneClass(s.return_dd ?? 0)} title="Return ÷ worst drawdown — profit per $1 of max pain (the single best pick metric)">{(s.return_dd ?? 0).toFixed(2)}</span> },
    { key: "pf", label: "PF", align: "right", sort: (s) => s.profit_factor ?? 0,
      cell: (s) => <span className="text-zinc-400">{s.profit_factor != null ? s.profit_factor.toFixed(2) : "∞"}</span> },
    { key: "n", label: "n", align: "right", sort: (s) => s.trades,
      cell: (s) => <span className="text-zinc-500">{s.trades}</span> },
    { key: "flags", label: "Flags",
      cell: (s) => (
        <div className="flex flex-wrap gap-1">
          {s.cash_account_ok ? <Badge tone="ok">cash-OK</Badge> : <Badge tone="warn">spread</Badge>}
          {s.affordable === false && <Badge tone="warn">over $1k</Badge>}
          {s.low_sample && <Badge tone="warn">low-n</Badge>}
        </div>
      ) },
  ];
  return (
    <SortableTable
      columns={columns}
      rows={rows}
      rowKey={(s) => `${s.symbol}-${s.strategy}-${s.account_size}`}
      initialKey="rank"
      initialDir="asc"
    />
  );
}

export function SurvivorsTable({ rows }: { rows: OptimizeCandidate[] }) {
  const columns: Col<OptimizeCandidate>[] = [
    { key: "symbol", label: "Sym", sort: (c) => c.symbol,
      cell: (c) => <span className="font-medium text-zinc-200">{c.symbol}</span> },
    { key: "strategy", label: "Strategy", sort: (c) => c.strategy_name,
      cell: (c) => <span className="text-zinc-300">{c.strategy_name}</span> },
    { key: "params", label: "Best params",
      cell: (c) => (
        <span className="text-xs text-zinc-500">
          {String(c.params.signal)} · tgt {Math.round(Number(c.params.target_pct) * 100)}% · stop {Math.round(Number(c.params.stop_pct) * 100)}%
        </span>
      ) },
    { key: "train", label: "Train $/day", align: "right", sort: (c) => c.train_avg_daily,
      cell: (c) => <span className={toneClass(c.train_avg_daily)}>{signed(c.train_avg_daily)}</span> },
    { key: "test", label: "Test $/day", align: "right", sort: (c) => c.test_avg_daily,
      cell: (c) => <span className={`font-medium ${toneClass(c.test_avg_daily)}`}>{signed(c.test_avg_daily)}</span> },
    { key: "win", label: "Test win", align: "right", sort: (c) => c.test_win,
      cell: (c) => <span className="text-zinc-300">{Math.round(c.test_win * 100)}%</span> },
    { key: "flag", label: "",
      cell: (c) => (c.cash_account_ok ? <Badge tone="ok">cash-OK</Badge> : <Badge tone="warn">spread</Badge>) },
  ];
  return (
    <SortableTable
      columns={columns}
      rows={rows}
      rowKey={(c, i) => `${c.symbol}-${c.strategy}-${i}`}
      initialKey="test"
      initialDir="desc"
    />
  );
}
