// Domain model + the BrokerProvider abstraction.
// Everything the dashboard renders comes through BrokerProvider, so the UI
// never knows or cares whether it's looking at demo data or a real brokerage.

export type DataSource = "demo" | "robinhood";

export interface Account {
  id: string;
  name: string;
  /** "agentic" = a Robinhood Agentic Trading account an AI agent connects to. */
  type: "individual" | "agentic";
  currency: string;
}

export interface Portfolio {
  equity: number;
  cash: number;
  buyingPower: number;
  dayPnl: number;
  dayPnlPct: number;
  totalPnl: number;
  totalPnlPct: number;
}

export interface Position {
  symbol: string;
  qty: number;
  avgCost: number;
  lastPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
}

export type OrderSide = "buy" | "sell";
export type OrderStatus = "filled" | "pending" | "cancelled";

export interface Order {
  id: string;
  symbol: string;
  side: OrderSide;
  qty: number;
  price: number;
  status: OrderStatus;
  createdAt: string; // ISO date
}

export interface PnlPoint {
  date: string; // YYYY-MM-DD
  equity: number;
  pnl: number;
  drawdownPct: number; // <= 0
}

export interface DailyTrades {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface DashboardData {
  source: DataSource;
  account: Account;
  portfolio: Portfolio;
  positions: Position[];
  orders: Order[];
  pnlSeries: PnlPoint[];
  dailyTrades: DailyTrades[];
}

/**
 * The single interface the entire dashboard depends on.
 * - DemoProvider: realistic generated data, no credentials needed.
 * - RobinhoodProvider (Phase 2): OAuth against Robinhood's official agent MCP
 *   endpoints, returning the same shape.
 */
export interface BrokerProvider {
  readonly source: DataSource;
  getDashboard(): Promise<DashboardData>;
}
