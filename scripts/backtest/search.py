"""Comprehensive same-day strategy search.

Sweeps the full space the user asked for — account size x strategy x DTE x
indicator/signal x entry time x profit-target x stop — with an out-of-sample
guard, and ranks by ACCOUNT-RELATIVE daily profit (return %, not raw $), so a
$100 account competes fairly with a $1,000 one. Every trade is opened and closed
the same day (DTE>0 just means holding a longer-dated option intraday).

    .venv/bin/python -m scripts.backtest.search          # full run (parallel)
    .venv/bin/python -m scripts.backtest.search --quick   # smaller grid

Writes src/lib/backtest/search.json. Options are STILL modeled (Black-Scholes,
VIX-anchored) — see README. Out-of-sample survival != live profit.
"""
from __future__ import annotations

import itertools
import json
import os
import sys
from multiprocessing import Pool

from .data import load_sessions
from .engine import BacktestResult, RunConfig, run_backtest
from .indicators import ALL_SIGNALS
from .metrics import summarize
from .strategies import REGISTRY

OUT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "src", "lib", "backtest", "search.json",
)

# SPY/QQQ/IWM have true daily 0DTE + weeklies; NIO is a cheap name so a $100
# account can actually afford a contract.
SYMBOLS = ["SPY", "QQQ", "IWM", "NIO"]
ACCOUNTS = [100.0, 500.0, 1000.0]
DTES = [0, 1, 2, 5]
DIRECTIONAL = ["long_call_put", "long_otm", "credit_spread", "debit_spread"]
NON_DIRECTIONAL = ["long_straddle", "long_strangle", "cash_secured_put", "iron_condor"]

INNER = {
    "target_pct": [0.3, 0.5, 0.75, 1.0],
    "stop_pct": [0.4, 0.6, 1.0],
    "entry_minute": [9 * 60 + 45, 10 * 60, 11 * 60],
}
TRAIN_FRAC = 0.65
MIN_TRAIN_TRADES = 8
MIN_TEST_TRADES = 5

_SESS: dict[str, list] = {}  # per-worker session cache


def _sessions(symbol: str):
    if symbol not in _SESS:
        _SESS[symbol] = load_sessions(symbol, "5m")
    return _SESS[symbol]


def _sub(res: BacktestResult, days) -> dict:
    return summarize(BacktestResult(
        config=res.config, strategy_name=res.strategy_name,
        cash_account_ok=res.cash_account_ok, notes=res.notes,
        symbol=res.symbol, days=days))


def _inner_combos():
    keys = list(INNER)
    for vals in itertools.product(*(INNER[k] for k in keys)):
        yield dict(zip(keys, vals))


def eval_cell(cell: dict) -> dict | None:
    """One structural cell: sweep exit params, pick best-by-train, score on test."""
    sessions = _sessions(cell["symbol"])
    if not sessions:
        return None
    split = int(len(sessions) * TRAIN_FRAC)
    best = None
    for ex in _inner_combos():
        cfg = RunConfig(symbol=cell["symbol"], strategy=cell["strategy"],
                        account_size=cell["account"], dte=cell["dte"],
                        signal=cell["signal"], **ex)
        res = run_backtest(sessions, cfg)
        train = _sub(res, res.days[:split])
        test = _sub(res, res.days[split:])
        if train.get("trades", 0) < MIN_TRAIN_TRADES or test.get("trades", 0) < MIN_TEST_TRADES:
            continue
        # selection key = consistency-weighted train return% (only thing visible
        # "in advance"): rewards exits that are profitable AND steady, not just
        # high-magnitude — matching the goal of *consistent* daily profit.
        key = train["avg_daily_return_pct"] * max(0.05, train["daily_sharpe"])
        if best is None or key > best["_key"]:
            best = {
                "_key": key,
                "symbol": cell["symbol"], "strategy": cell["strategy"],
                "strategy_name": REGISTRY[cell["strategy"]].name,
                "cash_account_ok": REGISTRY[cell["strategy"]].cash_account_ok,
                "account": cell["account"], "dte": cell["dte"], "signal": cell["signal"],
                "params": ex,
                "train_ret_pct": train["avg_daily_return_pct"],
                "train_pnl": train["avg_daily_pnl"], "train_win": train["win_rate"],
                "test_ret_pct": test["avg_daily_return_pct"],
                "test_pnl": test["avg_daily_pnl"], "test_win": test["win_rate"],
                "test_sharpe": test["daily_sharpe"], "test_trades": test["trades"],
                "test_pf": test.get("profit_factor"), "test_max_dd": test.get("max_drawdown"),
                "test_participation": test.get("participation"),
                "robust": train["avg_daily_return_pct"] > 0 and test["avg_daily_return_pct"] > 0,
                # consistency-weighted, account-relative daily profit
                "oos_score": round(min(train["avg_daily_return_pct"], test["avg_daily_return_pct"])
                                   * max(0.0, test["daily_sharpe"]), 4),
            }
    if best:
        best.pop("_key", None)
    return best


def _cells(quick: bool):
    dtes = [0, 1] if quick else DTES
    syms = ["SPY", "QQQ", "NIO"] if quick else SYMBOLS
    sigs = ["always", "rsi", "macd", "vwap"] if quick else ALL_SIGNALS
    cells = []
    for sym in syms:
        for acct in ACCOUNTS:
            for dte in dtes:
                for strat in DIRECTIONAL:
                    for sig in sigs:
                        cells.append({"symbol": sym, "account": acct, "dte": dte,
                                      "strategy": strat, "signal": sig})
                for strat in NON_DIRECTIONAL:
                    cells.append({"symbol": sym, "account": acct, "dte": dte,
                                  "strategy": strat, "signal": "always"})
    return cells


def main(argv) -> int:
    quick = "--quick" in argv
    cells = _cells(quick)
    inner = len(list(_inner_combos()))
    procs = max(1, (os.cpu_count() or 4) - 1)
    print(f"Search: {len(cells)} cells x {inner} exit combos = "
          f"{len(cells) * inner:,} backtests on {procs} procs...", file=sys.stderr)

    with Pool(procs) as pool:
        results = [r for r in pool.map(eval_cell, cells, chunksize=8) if r]

    robust = [r for r in results if r["robust"] and r["test_trades"] >= MIN_TEST_TRADES]
    robust.sort(key=lambda r: r["oos_score"], reverse=True)

    # Per-account-size best (cash-legal only — what a cash account can place).
    by_account = {}
    for acct in ACCOUNTS:
        legal = [r for r in robust if r["cash_account_ok"] and r["account"] == acct]
        by_account[str(int(acct))] = legal[0] if legal else None

    cash_legal = [r for r in robust if r["cash_account_ok"]]

    report = {
        "methodology": "Account-relative (return %) ranking with 65/35 train/test "
                       "out-of-sample guard. Same-day open/close; DTE>0 = longer-"
                       "dated option held intraday. Options modeled (Black-Scholes, "
                       "VIX-anchored). Out-of-sample survival is NOT a profit promise.",
        "symbols": SYMBOLS if not quick else ["SPY", "QQQ", "NIO"],
        "accounts": ACCOUNTS, "dtes": DTES, "signals": ALL_SIGNALS,
        "inner_grid": INNER, "train_frac": TRAIN_FRAC,
        "total_cells": len(cells), "robust_count": len(robust),
        "best_by_account": by_account,
        "robust_cash_legal": cash_legal[:40],
        "robust_all": robust[:60],
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as fh:
        json.dump(report, fh, indent=2)
    print(f"Wrote -> {OUT_PATH}\n", file=sys.stderr)

    def line(r):
        legal = "" if r["cash_account_ok"] else "  [needs spread approval]"
        return (f"  ${int(r['account']):>4} {r['symbol']:4} {r['strategy_name'][:22]:22} "
                f"dte{r['dte']} {r['signal']:9} "
                f"tgt{r['params']['target_pct']}/stp{r['params']['stop_pct']}@{r['params']['entry_minute']}  "
                f"TEST {r['test_ret_pct']:+.2f}%/day (${r['test_pnl']:+.0f}) "
                f"win{r['test_win']:.0%} sh{r['test_sharpe']:.2f} n{r['test_trades']}{legal}")

    print("=== BEST CASH-ACCOUNT-LEGAL, robust, by ACCOUNT SIZE ===", file=sys.stderr)
    for acct, r in by_account.items():
        print(f"  ${acct}: " + (line(r).strip() if r else "no robust cash-legal config"),
              file=sys.stderr)
    print("\n=== TOP 15 cash-legal (out-of-sample, account-relative) ===", file=sys.stderr)
    for r in cash_legal[:15]:
        print(line(r), file=sys.stderr)
    print("\n=== TOP 8 overall (incl. spreads needing approval) ===", file=sys.stderr)
    for r in robust[:8]:
        print(line(r), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
