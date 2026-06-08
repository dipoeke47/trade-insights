// Date-range windowing: the whole dashboard re-scopes to a selected range.
//
// Activity-derived metrics (realized P&L, the P&L curve, trade counts, the
// transactions table) are recomputed for [from, to]. Realized P&L is PERIOD
// P&L — the curve starts at 0 at the range start (what "daily/weekly/monthly/
// YTD P&L" means). Account balances are point-in-time and handled separately.

import type {
  AssetType,
  DashboardData,
  PnlPoint,
  RealizedEvent,
  Transaction,
} from "@/lib/broker/types";

export type RangePreset = "1D" | "1W" | "1M" | "YTD" | "1Y" | "ALL";
export const RANGE_PRESETS: RangePreset[] = ["1D", "1W", "1M", "YTD", "1Y", "ALL"];

const DAY = 86_400_000;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function parseISO(s: string): Date {
  return new Date(s.length > 10 ? s : `${s}T00:00:00`);
}
function fmtD(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

/** Real transactions if present, else map the (possibly capped) orders list. */
export function deriveTransactions(d: DashboardData): Transaction[] {
  if (d.transactions?.length) return d.transactions;
  return (d.orders ?? []).map((o) => ({
    id: o.id,
    date: o.createdAt,
    symbol: o.symbol,
    assetType: o.assetType ?? "stock",
    detail: o.detail,
    side: o.side,
    qty: o.qty,
    price: o.price,
    status: o.status,
  }));
}

/** Real realized events if present, else derive day-deltas from pnlSeries. */
export function deriveEvents(d: DashboardData): RealizedEvent[] {
  if (d.realizedEvents?.length) return d.realizedEvents;
  const out: RealizedEvent[] = [];
  let prev = 0;
  for (const p of d.pnlSeries ?? []) {
    const amount = +(p.pnl - prev).toFixed(2);
    prev = p.pnl;
    if (Math.abs(amount) > 1e-9) {
      out.push({ date: p.date, amount, assetType: "stock", symbol: "" });
    }
  }
  return out;
}

/** Anchor relative presets (1D/1W/…) to the latest activity in the snapshot,
 *  so they're meaningful against static data rather than wall-clock "now". */
export function anchorDate(txns: Transaction[], events: RealizedEvent[]): Date {
  const dates = [...txns.map((t) => t.date), ...events.map((e) => e.date)]
    .map((s) => s.slice(0, 10))
    .sort();
  return dates.length ? startOfDay(parseISO(dates[dates.length - 1])) : startOfDay(new Date());
}

export interface ResolvedRange {
  from: Date;
  to: Date;
  label: string;
  preset: RangePreset | "CUSTOM";
}

export function resolveRange(
  preset: RangePreset,
  anchor: Date,
  from?: string,
  to?: string,
): ResolvedRange {
  const end = to ? startOfDay(parseISO(to)) : anchor;
  if (from || to) {
    const start = from ? startOfDay(parseISO(from)) : new Date(0);
    return { from: start, to: end, label: `${fmtD(start)} – ${fmtD(end)}`, preset: "CUSTOM" };
  }
  let start: Date;
  let label: string;
  switch (preset) {
    case "1D": start = end; label = "Today"; break;
    case "1W": start = new Date(end.getTime() - 6 * DAY); label = "1 week"; break;
    case "1M": start = new Date(end.getFullYear(), end.getMonth() - 1, end.getDate()); label = "1 month"; break;
    case "YTD": start = new Date(end.getFullYear(), 0, 1); label = `YTD ${end.getFullYear()}`; break;
    case "1Y": start = new Date(end.getFullYear() - 1, end.getMonth(), end.getDate()); label = "1 year"; break;
    default: start = new Date(0); label = "All time"; break;
  }
  return { from: start, to: end, label, preset };
}

function inRange(s: string, from: Date, to: Date): boolean {
  const t = parseISO(s.slice(0, 10)).getTime();
  return t >= from.getTime() && t <= to.getTime();
}

export interface SymbolPnl {
  symbol: string;
  realized: number;
  trades: number;
  assetType: AssetType | "mixed";
}

export interface WindowView {
  realizedTotal: number;
  tradeCount: number;
  optionTradeCount: number;
  stockTradeCount: number;
  pnlSeries: PnlPoint[]; // cumulative realized within range (starts ~0)
  maxDrawdown: number;
  dailyTrades: { date: string; count: number }[];
  transactions: Transaction[];
  bySymbol: SymbolPnl[]; // realized P&L per symbol, descending
}

export function windowView(d: DashboardData, from: Date, to: Date): WindowView {
  const events = deriveEvents(d).filter((e) => inRange(e.date, from, to));
  const txns = deriveTransactions(d).filter((t) => inRange(t.date, from, to));

  const realizedTotal = +events.reduce((s, e) => s + e.amount, 0).toFixed(2);

  // cumulative realized curve, by day
  const byDay = new Map<string, number>();
  for (const e of events) {
    const k = e.date.slice(0, 10);
    byDay.set(k, (byDay.get(k) ?? 0) + e.amount);
  }
  let cum = 0;
  let peak = Number.NEGATIVE_INFINITY;
  let maxDrawdown = 0;
  const pnlSeries: PnlPoint[] = [...byDay.keys()].sort().map((day) => {
    cum += byDay.get(day)!;
    peak = Math.max(peak, cum);
    const dd = peak > 0 ? +(((cum - peak) / peak) * 100).toFixed(2) : 0;
    maxDrawdown = Math.min(maxDrawdown, dd);
    return { date: day, equity: +cum.toFixed(2), pnl: +cum.toFixed(2), drawdownPct: dd };
  });

  const filled = txns.filter((t) => t.status === "filled");
  const fills = new Map<string, number>();
  for (const t of filled) {
    const k = t.date.slice(0, 10);
    fills.set(k, (fills.get(k) ?? 0) + 1);
  }
  const dailyTrades = [...fills.keys()].sort().map((date) => ({ date, count: fills.get(date)! }));

  // realized P&L per symbol (top winners / losers)
  const symRealized = new Map<string, { realized: number; types: Set<AssetType> }>();
  for (const e of events) {
    const k = e.symbol || "—";
    const cur = symRealized.get(k) ?? { realized: 0, types: new Set<AssetType>() };
    cur.realized += e.amount;
    cur.types.add(e.assetType);
    symRealized.set(k, cur);
  }
  const symTrades = new Map<string, number>();
  for (const t of filled) symTrades.set(t.symbol, (symTrades.get(t.symbol) ?? 0) + 1);
  const bySymbol: SymbolPnl[] = [...symRealized.entries()]
    .map(([symbol, v]) => ({
      symbol,
      realized: +v.realized.toFixed(2),
      trades: symTrades.get(symbol) ?? 0,
      assetType: (v.types.size > 1 ? "mixed" : [...v.types][0]) as AssetType | "mixed",
    }))
    .sort((a, b) => b.realized - a.realized);

  return {
    realizedTotal,
    tradeCount: filled.length,
    optionTradeCount: txns.filter((t) => t.assetType === "option").length,
    stockTradeCount: txns.filter((t) => t.assetType !== "option").length,
    pnlSeries,
    maxDrawdown,
    dailyTrades,
    transactions: [...txns].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100),
    bySymbol,
  };
}
