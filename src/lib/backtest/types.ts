// Types mirroring the Python backtester's JSON output
// (scripts/backtest/*). The dashboard reads the committed ranked.json /
// optimized.json for the leaderboard, and POSTs to /api/backtest for live runs.

export interface StrategyMeta {
  key: string;
  name: string;
  category: "long_premium" | "short_premium" | "spread" | "stock_option";
  cashAccountOk: boolean;
  blurb: string;
}

/** Kept in sync with scripts/backtest/strategies.py REGISTRY. */
export const STRATEGIES: StrategyMeta[] = [
  { key: "long_call_put", name: "Long Call / Put (directional 0DTE)", category: "long_premium", cashAccountOk: true, blurb: "Buy ATM call (up) or put (down). Pure intraday direction + gamma." },
  { key: "long_otm", name: "Long OTM Call / Put (lotto 0DTE)", category: "long_premium", cashAccountOk: true, blurb: "Cheaper OTM long — more leverage, lower win rate." },
  { key: "long_straddle", name: "Long Straddle (ATM call+put)", category: "long_premium", cashAccountOk: true, blurb: "Non-directional breakout. Needs a big move to beat theta." },
  { key: "long_strangle", name: "Long Strangle (OTM call+put)", category: "long_premium", cashAccountOk: true, blurb: "Cheaper non-directional breakout play." },
  { key: "cash_secured_put", name: "Cash-Secured Put (sell put)", category: "short_premium", cashAccountOk: true, blurb: "Sell OTM put, collateral = strike×100. Only fits $1k on sub-$10 names." },
  { key: "covered_call", name: "Covered Call (100sh + short call)", category: "stock_option", cashAccountOk: true, blurb: "Needs 100 shares — only sub-$10 names fit $1k; premium tiny there." },
  { key: "covered_put", name: "Covered/Short Put", category: "stock_option", cashAccountOk: false, blurb: "Requires shorting stock — not cash-account legal." },
  { key: "debit_spread", name: "Vertical Debit Spread", category: "spread", cashAccountOk: false, blurb: "Defined-risk directional. Needs spread approval." },
  { key: "credit_spread", name: "Vertical Credit Spread", category: "spread", cashAccountOk: false, blurb: "Defined-risk premium selling. Needs spread approval." },
  { key: "iron_condor", name: "Iron Condor (0DTE)", category: "spread", cashAccountOk: false, blurb: "Range-bound premium selling. Needs spread approval." },
];

export const SYMBOLS = ["SPY", "QQQ", "IWM", "NIO", "GRAB", "PLUG"];
export const ACCOUNT_SIZES = [100, 200, 500, 1000];
export const SIGNALS = [
  "momentum", "orb", "always", "vwap", "macd", "stoch", "smi", "rsi", "ema_cross",
] as const;

export interface DayResult {
  day: string;
  traded: boolean;
  direction: number;
  units: number;
  capital_required: number;
  pnl: number;
  pnl_per_unit: number;
  return_pct: number;
  exit_reason: string;
  affordable: boolean;
}

export interface Summary {
  symbol: string;
  strategy: string;
  strategy_name: string;
  cash_account_ok: boolean;
  affordable?: boolean;
  low_sample?: boolean;
  notes?: string;
  account_size?: number;
  trades: number;
  total_days?: number;
  participation?: number;
  avg_daily_pnl?: number;
  median_daily_pnl?: number;
  std_daily_pnl?: number;
  total_pnl?: number;
  win_rate?: number;
  pct_green_of_all_days?: number;
  profit_factor?: number | null;
  avg_win?: number;
  avg_loss?: number;
  max_drawdown?: number;
  daily_sharpe?: number;
  avg_capital_deployed?: number;
  avg_units?: number;
  exit_mix?: Record<string, number>;
  equity_curve?: number[];
  score: number;
  rank?: number;
  error?: string;
  days?: DayResult[];
}

export interface RankedReport {
  generatedAt: string | null;
  methodology: string;
  interval: string;
  sample_trading_days: number;
  symbols: string[];
  account_sizes: number[];
  ranked: Summary[];
  skipped: Summary[];
}

export interface OptimizeCandidate {
  symbol: string;
  strategy: string;
  strategy_name: string;
  cash_account_ok: boolean;
  params: Record<string, number | string>;
  train_avg_daily: number;
  train_score: number;
  train_win: number;
  test_avg_daily: number;
  test_score: number;
  test_win: number;
  test_trades: number;
  test_profit_factor: number | null;
  test_max_dd: number;
  robust: boolean;
  out_of_sample_consistency: number;
}

export interface OptimizeConfig {
  symbol: string;
  strategy: string;
  strategy_name: string;
  cash_account_ok: boolean;
  best_by_train: OptimizeCandidate | null;
  best_robust: OptimizeCandidate | null;
  robust_count: number;
  total_tested: number;
}

export interface OptimizeReport {
  methodology: string;
  train_frac: number;
  account_size: number;
  param_grid: Record<string, (number | string)[]>;
  configs: OptimizeConfig[];
}

export interface RunRequest {
  symbol: string;
  strategy: string;
  account_size: number;
  entry_minute?: number;
  time_exit_minute?: number;
  target_pct?: number;
  stop_pct?: number;
  iv_multiplier?: number;
  signal?: string;
}
