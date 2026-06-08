"""Daily-profitability metrics + a consistency-oriented ranking score.

The user wants the *most consistent daily profitable* strategy, so the headline
score rewards a high average daily $ with low day-to-day variance (a daily
Sharpe) and a high share of green days — not just raw total return.
"""
from __future__ import annotations

import math

from .engine import BacktestResult


def _stats(xs: list[float]) -> tuple[float, float]:
    if not xs:
        return 0.0, 0.0
    n = len(xs)
    mean = sum(xs) / n
    if n < 2:
        return mean, 0.0
    var = sum((x - mean) ** 2 for x in xs) / (n - 1)
    return mean, math.sqrt(var)


def summarize(result: BacktestResult) -> dict:
    traded = [d for d in result.days if d.traded]
    pnls = [d.pnl for d in traded]
    all_days = len(result.days)
    n = len(traded)

    if n == 0:
        unaffordable = any(d.exit_reason == "unaffordable" for d in result.days)
        cap = next((d.capital_required for d in result.days
                    if d.exit_reason == "unaffordable"), None)
        if unaffordable:
            reason = (f"unaffordable: needs ~${cap:,.0f} per unit, "
                      f"account is ${result.config.get('account_size'):,.0f}")
        else:
            reason = result.error or "no trades taken (signal never fired)"
        return {
            "symbol": result.symbol,
            "strategy": result.config.get("strategy"),
            "strategy_name": result.strategy_name,
            "cash_account_ok": result.cash_account_ok,
            "account_size": result.config.get("account_size"),
            "affordable": not unaffordable,
            "notes": result.notes,
            "error": reason,
            "trades": 0,
            "total_days": all_days,
            "score": -999.0,
        }

    mean, std = _stats(pnls)
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]
    gross_win = sum(wins)
    gross_loss = -sum(losses)
    win_rate = len(wins) / n
    pct_green_of_all = len(wins) / all_days if all_days else 0.0
    profit_factor = (gross_win / gross_loss) if gross_loss > 1e-9 else (
        float("inf") if gross_win > 0 else 0.0)

    # Equity curve + max drawdown over traded days (sized $).
    equity, peak, max_dd = 0.0, 0.0, 0.0
    curve = []
    for d in traded:
        equity += d.pnl
        peak = max(peak, equity)
        max_dd = min(max_dd, equity - peak)
        curve.append(round(equity, 2))

    # Floor the volatility estimate so a tiny all-wins sample can't fake an
    # infinite Sharpe (std underestimates true risk at small n).
    std_eff = max(std, 0.20 * abs(mean), 1e-9)
    daily_sharpe = mean / std_eff
    avg_capital = sum(d.capital_required * max(d.units, 1) for d in traded) / n
    affordable = all(d.affordable for d in traded)
    avg_units = sum(d.units for d in traded) / n
    participation = n / all_days if all_days else 0.0

    # Consistency score: daily Sharpe scaled by green-day share, nudged by the
    # average daily $, then discounted for statistical un-confidence:
    #  - confidence: full credit only at 20+ trades
    #  - participation: a strategy that trades 3 of 60 days isn't "daily" income
    #  - low_sample gate: <8 trades is essentially noise
    #  - legality/affordability: must fit the user's $1k cash account
    dollar_factor = 1.0 + max(-0.5, min(2.0, mean / 25.0))  # +$25/day ~ 2x weight
    confidence = min(1.0, n / 20.0)
    participation_factor = min(1.0, participation / 0.4)
    low_sample = n < 8
    score = daily_sharpe * (0.5 + win_rate) * dollar_factor
    score *= confidence * participation_factor
    if low_sample:
        score *= 0.25
    if not result.cash_account_ok:
        score *= 0.6
    if not affordable:
        score *= 0.3

    return {
        "symbol": result.symbol,
        "strategy": result.config.get("strategy"),
        "strategy_name": result.strategy_name,
        "cash_account_ok": result.cash_account_ok,
        "affordable": affordable,
        "notes": result.notes,
        "account_size": result.config.get("account_size"),
        "trades": n,
        "total_days": all_days,
        "participation": round(participation, 3),
        "low_sample": low_sample,
        "avg_daily_pnl": round(mean, 2),
        "median_daily_pnl": round(sorted(pnls)[n // 2], 2),
        "std_daily_pnl": round(std, 2),
        "total_pnl": round(sum(pnls), 2),
        "win_rate": round(win_rate, 3),
        "pct_green_of_all_days": round(pct_green_of_all, 3),
        "profit_factor": round(profit_factor, 2) if profit_factor != float("inf") else None,
        "avg_win": round(sum(wins) / len(wins), 2) if wins else 0.0,
        "avg_loss": round(sum(losses) / len(losses), 2) if losses else 0.0,
        "max_drawdown": round(max_dd, 2),
        "daily_sharpe": round(daily_sharpe, 3),
        "avg_capital_deployed": round(avg_capital, 2),
        "avg_units": round(avg_units, 2),
        "exit_mix": _exit_mix(traded),
        "equity_curve": curve,
        "score": round(score, 3),
    }


def _exit_mix(traded) -> dict:
    mix: dict[str, int] = {}
    for d in traded:
        mix[d.exit_reason] = mix.get(d.exit_reason, 0) + 1
    return mix


def rank(summaries: list[dict]) -> list[dict]:
    ranked = sorted(summaries, key=lambda s: s.get("score", -999), reverse=True)
    for i, s in enumerate(ranked, 1):
        s["rank"] = i
    return ranked
