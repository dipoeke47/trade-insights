"""Sweep the full strategy x symbol x account-size grid, rank by the daily
consistency score, and write a JSON report the dashboard reads by default.

    .venv/bin/python -m scripts.backtest.rank_all

Output: src/lib/backtest/ranked.json (committed — it's just SPY/QQQ/etc. stats,
no personal data). Re-run any time to refresh.
"""
from __future__ import annotations

import json
import os
import sys

from .data import load_sessions
from .engine import RunConfig, run_backtest
from .metrics import rank, summarize
from .strategies import REGISTRY

OUT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "src", "lib", "backtest", "ranked.json",
)

# Index ETFs have true daily (0DTE) expiries + deep liquidity -> the only place
# long-premium / spread 0DTE strategies are realistic. Cheap single names give
# the capital-heavy premium-selling strategies (CSP / covered call) something
# that actually fits a $1k cash account.
ETFS = ["SPY", "QQQ", "IWM"]          # liquid 0DTE
CHEAP: list[str] = []                 # (cheap single names removed — ETFs only)
SYMBOLS = ETFS + CHEAP
ACCOUNT_SIZES = [200.0, 500.0, 1000.0]
INTERVAL = "5m"


def _symbol_strategies(symbol: str) -> list[str]:
    """Pick strategies that are realistic on this underlying.

    - Long premium + spreads: only on liquid-0DTE ETFs.
    - CSP / covered call / covered put: only on cheap names (collateral fits $1k).
      (Cheap names lack true 0DTE; modeled same-day is optimistic — flagged.)
    """
    is_etf = symbol in ETFS
    out = []
    for key, s in REGISTRY.items():
        if s.category in ("long_premium", "spread"):
            if is_etf:
                out.append(key)
        elif s.category in ("short_premium", "stock_option"):
            if not is_etf:
                out.append(key)
    return out


def main() -> int:
    summaries: list[dict] = []
    session_cache: dict[str, list] = {}
    grid = []
    for symbol in SYMBOLS:
        for strategy in _symbol_strategies(symbol):
            for acct in ACCOUNT_SIZES:
                grid.append((symbol, strategy, acct))

    print(f"Running {len(grid)} backtests across "
          f"{len(SYMBOLS)} symbols x strategies x {len(ACCOUNT_SIZES)} sizes...",
          file=sys.stderr)

    for i, (symbol, strategy, acct) in enumerate(grid, 1):
        if symbol not in session_cache:
            session_cache[symbol] = load_sessions(symbol, INTERVAL)
        sessions = session_cache[symbol]
        cfg = RunConfig(symbol=symbol, strategy=strategy, account_size=acct, interval=INTERVAL)
        result = run_backtest(sessions, cfg)
        s = summarize(result)
        summaries.append(s)
        tag = f"{symbol:5} {strategy:18} ${int(acct):<5}"
        if s.get("trades"):
            print(f"  [{i:>3}/{len(grid)}] {tag} score={s['score']:>7} "
                  f"avg/day=${s['avg_daily_pnl']:>7} win={s['win_rate']:.0%} "
                  f"n={s['trades']}", file=sys.stderr)
        else:
            print(f"  [{i:>3}/{len(grid)}] {tag} -- {s.get('error','no trades')}",
                  file=sys.stderr)

    ranked = rank([s for s in summaries if s.get("trades")])
    skipped = [s for s in summaries if not s.get("trades")]

    sample_days = 0
    if session_cache.get("SPY"):
        sample_days = len(session_cache["SPY"])

    report = {
        "generatedAt": None,  # stamped by the caller / git; env forbids Date
        "methodology": "Black-Scholes modeled options on real yfinance intraday "
                       "underlying data + VIX-derived IV. Modeled fills, not real "
                       "market quotes. Good for relative ranking; approximate $.",
        "interval": INTERVAL,
        "sample_trading_days": sample_days,
        "symbols": SYMBOLS,
        "account_sizes": ACCOUNT_SIZES,
        "ranked": ranked,
        "skipped": skipped,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as fh:
        json.dump(report, fh, indent=2)
    print(f"\nWrote {len(ranked)} ranked results -> {OUT_PATH}", file=sys.stderr)
    if ranked:
        print("\nTOP 10 by daily-consistency score:", file=sys.stderr)
        for s in ranked[:10]:
            print(f"  #{s['rank']:>2} {s['symbol']:5} {s['strategy_name'][:34]:34} "
                  f"${int(s['account_size']):<5} score={s['score']:>7} "
                  f"avg/day=${s['avg_daily_pnl']:>7} win={s['win_rate']:.0%}",
                  file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
