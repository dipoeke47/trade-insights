// DemoProvider — deterministic, realistic portfolio data with no credentials.
// Seeded PRNG keeps the equity curve stable across reloads (only the trailing
// date window rolls forward), so charts don't flicker between requests.

import type {
  BrokerProvider,
  DashboardData,
  DailyTrades,
  Order,
  PnlPoint,
  Position,
} from "./types";

function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const DAYS = 90;
const START_EQUITY = 25_000;

const SEEDS = [
  { symbol: "NVDA", avgCost: 118.4 },
  { symbol: "AAPL", avgCost: 208.1 },
  { symbol: "MSFT", avgCost: 412.7 },
  { symbol: "TSLA", avgCost: 244.9 },
  { symbol: "AMZN", avgCost: 178.3 },
];

function buildPnlSeries(): PnlPoint[] {
  const rand = mulberry32(424242);
  const points: PnlPoint[] = [];
  let equity = START_EQUITY;
  let peak = START_EQUITY;
  const today = new Date();

  for (let i = DAYS - 1; i >= 0; i--) {
    // Mild gaussian-ish daily return: slight positive drift, ~1.6% vol.
    const r = (rand() - 0.5 + rand() - 0.5) * 0.016 + 0.0007;
    equity = equity * (1 + r);
    peak = Math.max(peak, equity);
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    points.push({
      date: isoDay(date),
      equity: Math.round(equity),
      pnl: Math.round(equity - START_EQUITY),
      drawdownPct: +(((equity - peak) / peak) * 100).toFixed(2),
    });
  }
  return points;
}

function buildPositions(lastEquity: number): Position[] {
  const rand = mulberry32(7);
  return SEEDS.map((s) => {
    const drift = 1 + (rand() - 0.4) * 0.35;
    const lastPrice = +(s.avgCost * drift).toFixed(2);
    const qty = Math.max(1, Math.round((lastEquity * (0.1 + rand() * 0.12)) / lastPrice));
    const marketValue = +(qty * lastPrice).toFixed(2);
    const cost = qty * s.avgCost;
    const unrealizedPnl = +(marketValue - cost).toFixed(2);
    return {
      symbol: s.symbol,
      qty,
      avgCost: s.avgCost,
      lastPrice,
      marketValue,
      unrealizedPnl,
      unrealizedPnlPct: +((unrealizedPnl / cost) * 100).toFixed(2),
    };
  });
}

function buildOrders(positions: Position[]): Order[] {
  const rand = mulberry32(99);
  const orders: Order[] = [];
  const today = new Date();
  for (let i = 0; i < 8; i++) {
    const p = positions[Math.floor(rand() * positions.length)];
    const date = new Date(today);
    date.setDate(today.getDate() - Math.floor(rand() * 14));
    orders.push({
      id: `ord_${(1000 + i).toString(36)}`,
      symbol: p.symbol,
      side: rand() > 0.5 ? "buy" : "sell",
      qty: 1 + Math.floor(rand() * 12),
      price: +(p.lastPrice * (0.97 + rand() * 0.06)).toFixed(2),
      status: rand() > 0.2 ? "filled" : rand() > 0.5 ? "pending" : "cancelled",
      createdAt: date.toISOString(),
    });
  }
  return orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function buildDailyTrades(series: PnlPoint[]): DailyTrades[] {
  const rand = mulberry32(2024);
  return series.slice(-30).map((p) => ({
    date: p.date,
    count: Math.floor(rand() * 9),
  }));
}

export class DemoProvider implements BrokerProvider {
  readonly source = "demo" as const;

  async getDashboard(): Promise<DashboardData> {
    const pnlSeries = buildPnlSeries();
    const last = pnlSeries[pnlSeries.length - 1];
    const prev = pnlSeries[pnlSeries.length - 2] ?? last;
    const positions = buildPositions(last.equity);
    const orders = buildOrders(positions);
    const dailyTrades = buildDailyTrades(pnlSeries);

    const dayPnl = last.equity - prev.equity;
    const cash = Math.round(last.equity * 0.18);

    return {
      source: this.source,
      account: { id: "demo-agentic", name: "Agentic Demo", type: "agentic", currency: "USD" },
      portfolio: {
        equity: last.equity + cash,
        cash,
        buyingPower: cash * 2,
        dayPnl,
        dayPnlPct: +((dayPnl / prev.equity) * 100).toFixed(2),
        totalPnl: last.pnl,
        totalPnlPct: +((last.pnl / START_EQUITY) * 100).toFixed(2),
      },
      positions,
      orders,
      pnlSeries,
      dailyTrades,
    };
  }
}
