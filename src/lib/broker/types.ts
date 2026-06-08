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
  /** Aggregate options market value, when the broker reports it. */
  optionsValue?: number;
  dayPnl: number;
  dayPnlPct: number;
  totalPnl: number;
  totalPnlPct: number;
}

/** Lightweight account descriptor for the account switcher. */
export interface AccountSummary {
  id: string;
  name: string;
  type: "individual" | "agentic";
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
export type AssetType = "stock" | "option";

export interface Order {
  id: string;
  symbol: string;
  side: OrderSide;
  qty: number;
  price: number;
  status: OrderStatus;
  createdAt: string; // ISO date
  /** Defaults to "stock" when omitted. */
  assetType?: AssetType;
  /** Human-readable contract label for options, e.g. "$150 Call · exp 6/20". */
  detail?: string;
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

/** A single executed/attempted transaction (stock or option leg). */
export interface Transaction {
  id: string;
  date: string; // ISO
  symbol: string;
  assetType: AssetType;
  detail?: string;
  side: OrderSide;
  qty: number;
  price: number;
  status: OrderStatus;
}

/** A realized-P&L event (a position closing), used to window P&L by date. */
export interface RealizedEvent {
  date: string; // YYYY-MM-DD
  amount: number; // realized $ on this date (+/-)
  assetType: AssetType;
  symbol: string;
}

export interface DashboardData {
  source: DataSource;
  account: Account;
  portfolio: Portfolio;
  positions: Position[];
  orders: Order[];
  pnlSeries: PnlPoint[];
  dailyTrades: DailyTrades[];
  /** Full transaction history (real data). The UI windows over this by date. */
  transactions?: Transaction[];
  /** Full realized-P&L event history (real data). Summed/curved per range. */
  realizedEvents?: RealizedEvent[];
}

/**
 * The single interface the entire dashboard depends on.
 * - DemoProvider: realistic generated data, no credentials needed.
 * - RobinhoodProvider: reads a local snapshot of your real Robinhood data today;
 *   live OAuth against Robinhood's official agent MCP is the next step.
 *
 * Multi-account: listAccounts() powers the switcher; getDashboard(accountId)
 * returns one account's view. Omitting accountId yields the default account.
 */
export interface BrokerProvider {
  readonly source: DataSource;
  listAccounts(): Promise<AccountSummary[]>;
  getDashboard(accountId?: string): Promise<DashboardData>;
}
