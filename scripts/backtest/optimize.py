"""Guarded parameter search for the most consistent *daily-profitable* config.

The naive strategies are ~breakeven-to-negative once options are priced fairly,
so this searches entry timing / signal / exit rules for an edge — but with an
out-of-sample guard so we don't just curve-fit. Each config is scored on a TRAIN
window (first 65% of sessions) and only kept if it ALSO survives on the held-out
TEST window (last 35%). A config that's only good in-sample is reported as
overfit, not as an edge.

    .venv/bin/python -m scripts.backtest.optimize

Writes src/lib/backtest/optimized.json (committed; no personal data).
"""
from __future__ import annotations

import itertools
import json
import os
import sys

from .data import load_sessions
from .engine import BacktestResult, RunConfig, run_backtest
from .metrics import summarize
from .strategies import REGISTRY

OUT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "src", "lib", "backtest", "optimized.json",
)

# Focus: configurations a $1k cash account can actually place, plus spreads
# (flagged not-cash-legal) for completeness.
FOCUS = [
    ("SPY", "long_call_put"), ("QQQ", "long_call_put"), ("IWM", "long_call_put"),
    ("SPY", "long_straddle"), ("QQQ", "long_straddle"),
    ("SPY", "long_strangle"),
    ("NIO", "cash_secured_put"), ("GRAB", "cash_secured_put"), ("PLUG", "cash_secured_put"),
    ("SPY", "credit_spread"), ("QQQ", "credit_spread"), ("SPY", "iron_condor"),
]

PARAM_GRID = {
    "signal": ["momentum", "orb", "always"],
    "entry_minute": [9 * 60 + 35, 9 * 60 + 45, 10 * 60, 11 * 60],
    "target_pct": [0.3, 0.5, 0.75],
    "stop_pct": [0.4, 0.6, 1.0],
    "time_exit_minute": [15 * 60 + 55],
}
TRAIN_FRAC = 0.65
ACCOUNT = 1000.0


def _subset(result: BacktestResult, days) -> dict:
    sub = BacktestResult(
        config=result.config, strategy_name=result.strategy_name,
        cash_account_ok=result.cash_account_ok, notes=result.notes,
        symbol=result.symbol, days=days,
    )
    return summarize(sub)


def _combos():
    keys = list(PARAM_GRID)
    for vals in itertools.product(*(PARAM_GRID[k] for k in keys)):
        yield dict(zip(keys, vals))


def main() -> int:
    cache: dict[str, list] = {}
    results = []
    n_combos = len(list(_combos()))
    print(f"Optimizing {len(FOCUS)} configs x {n_combos} param combos "
          f"= {len(FOCUS) * n_combos} backtests (train/test split)...",
          file=sys.stderr)

    for symbol, strat_key in FOCUS:
        if symbol not in cache:
            cache[symbol] = load_sessions(symbol, "5m")
        sessions = cache[symbol]
        if not sessions:
            continue
        split = int(len(sessions) * TRAIN_FRAC)
        candidates = []
        for params in _combos():
            # direction-agnostic strategies ignore the signal; collapse to one.
            if not REGISTRY[strat_key].direction_aware and params["signal"] != "momentum":
                continue
            cfg = RunConfig(symbol=symbol, strategy=strat_key, account_size=ACCOUNT, **params)
            res = run_backtest(sessions, cfg)
            train = _subset(res, res.days[:split])
            test = _subset(res, res.days[split:])
            if train.get("trades", 0) < 5 or test.get("trades", 0) < 3:
                continue
            candidates.append({
                "symbol": symbol, "strategy": strat_key,
                "strategy_name": REGISTRY[strat_key].name,
                "cash_account_ok": REGISTRY[strat_key].cash_account_ok,
                "params": params,
                "train_avg_daily": train["avg_daily_pnl"], "train_score": train["score"],
                "train_win": train["win_rate"],
                "test_avg_daily": test["avg_daily_pnl"], "test_score": test["score"],
                "test_win": test["win_rate"], "test_trades": test["trades"],
                "test_profit_factor": test.get("profit_factor"),
                "test_max_dd": test.get("max_drawdown"),
                # robust = positive AND consistent in BOTH windows
                "robust": train["avg_daily_pnl"] > 0 and test["avg_daily_pnl"] > 0,
                "out_of_sample_consistency": round(min(train["score"], test["score"]), 3),
            })
        # Pick the best by train score (the only thing visible "in advance"),
        # then we report how it actually did on the held-out test set.
        candidates.sort(key=lambda c: c["train_score"], reverse=True)
        best_by_train = candidates[0] if candidates else None
        robust = [c for c in candidates if c["robust"]]
        robust.sort(key=lambda c: c["out_of_sample_consistency"], reverse=True)
        results.append({
            "symbol": symbol, "strategy": strat_key,
            "strategy_name": REGISTRY[strat_key].name,
            "cash_account_ok": REGISTRY[strat_key].cash_account_ok,
            "best_by_train": best_by_train,
            "best_robust": robust[0] if robust else None,
            "robust_count": len(robust),
            "total_tested": len(candidates),
        })
        tag = f"{symbol:5} {strat_key:16}"
        if robust:
            b = robust[0]
            print(f"  {tag} robust={len(robust):>3}/{len(candidates)} "
                  f"BEST test=${b['test_avg_daily']:>7}/day win={b['test_win']:.0%} "
                  f"{b['params']['signal']}@{b['params']['entry_minute']} "
                  f"tgt{b['params']['target_pct']}/stp{b['params']['stop_pct']}",
                  file=sys.stderr)
        else:
            bt = best_by_train
            oos = f"test=${bt['test_avg_daily']}/day" if bt else "n/a"
            print(f"  {tag} robust=  0/{len(candidates)} "
                  f"(best-in-train overfit -> {oos})", file=sys.stderr)

    report = {
        "methodology": "Train/test split (65/35). 'robust' = positive average "
                       "daily P&L in BOTH windows. Options priced via VIX-anchored "
                       "Black-Scholes on real intraday data. Modeled, not real fills.",
        "train_frac": TRAIN_FRAC, "account_size": ACCOUNT,
        "param_grid": PARAM_GRID, "configs": results,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as fh:
        json.dump(report, fh, indent=2)
    print(f"\nWrote -> {OUT_PATH}", file=sys.stderr)

    robust_overall = [r["best_robust"] for r in results if r["best_robust"]]
    robust_overall.sort(key=lambda c: c["test_avg_daily"], reverse=True)
    print("\nROBUST (out-of-sample positive) configs, best test avg/day:", file=sys.stderr)
    if not robust_overall:
        print("  NONE survived out-of-sample. Honest result: no robust intraday "
              "edge in the affordable/legal set on this sample.", file=sys.stderr)
    for c in robust_overall[:12]:
        legal = "" if c["cash_account_ok"] else "  [needs spread approval]"
        print(f"  {c['symbol']:5} {c['strategy_name'][:26]:26} "
              f"test=${c['test_avg_daily']:>7}/day win={c['test_win']:.0%} "
              f"train=${c['train_avg_daily']:>7}/day{legal}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
