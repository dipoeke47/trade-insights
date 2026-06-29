"""Multi-day (swing) backtester — hold a position across days, to expiry.

Why this is MORE trustworthy than the intraday engine: the exit payoff is the
option's *intrinsic value at expiration*, computed from the REAL underlying
price N days later. Only the entry premium is modeled (Black-Scholes). So the
biggest driver — did the trade win or lose — comes from real price history, not
a model. Uses ~2 years of daily bars (hundreds of trades, not 60 days).

IV anchor: SPY->VIX, QQQ->VXN (both real, traded vol indices), IWM->VIX×1.25
(RVX proxy; RVX isn't on the free feed).

    .venv/bin/python -m scripts.backtest.swing
"""
from __future__ import annotations

import json
import math
import sys
from dataclasses import dataclass

from .data import fetch
from .pricing import black_scholes
from . import strategies as strat

ETFS = ["SPY", "QQQ", "IWM"]
HOLDS = [1, 2, 5, 7, 14, 30]          # trading days held (≈ option DTE at entry)
VOL_INDEX = {"SPY": ("^VIX", 1.0), "QQQ": ("^VXN", 1.0), "IWM": ("^VIX", 1.25)}


@dataclass
class Day:
    i: int
    date: object
    close: float


def _daily(symbol: str):
    df = fetch(symbol, "1d", "2y")
    days = []
    for k, (ts, row) in enumerate(df.iterrows()):
        c = float(row["Close"])
        if c > 0:
            days.append(Day(len(days), ts.date(), c))
    return days


def _iv_map(symbol: str):
    idx, mult = VOL_INDEX[symbol]
    df = fetch(idx, "1d", "2y")
    return {ts.date(): float(row["Close"]) / 100.0 * mult for ts, row in df.iterrows()}


def _iv_for(iv_map, date, fallback=0.18):
    if date in iv_map:
        return iv_map[date]
    prior = [d for d in iv_map if d <= date]
    return iv_map[max(prior)] if prior else fallback


def _legs_priced(legs, spot, iv, t_years, rate=0.04):
    """Return [(leg, strike, entry_mid)] for the strategy at entry."""
    out = []
    inc = 1.0 if spot >= 50 else 0.5
    for lg in legs:
        if lg.kind == "stock":
            out.append((lg, spot, spot))
            continue
        strike = round(spot * (1 + lg.moneyness) / inc) * inc
        g = black_scholes(spot, strike, t_years, iv, lg.kind == "call", rate)
        out.append((lg, strike, g.price))
    return out


def _value(priced, spot, iv, t_years, rate=0.04):
    """Mark-to-market value of the whole position (per unit), signed."""
    total = 0.0
    for lg, strike, entry in priced:
        if lg.kind == "stock":
            cur = spot
        else:
            cur = black_scholes(spot, strike, max(t_years, 0.0), iv, lg.kind == "call", rate).price
        total += (cur - entry) * (100 if lg.kind != "stock" else 100) * (1 if lg.qty > 0 else -1)
    return total


def _capital(priced, spot):
    long_opt = sum(p * 100 for lg, k, p in priced if lg.kind != "stock" and lg.qty > 0)
    short_opt = sum(p * 100 for lg, k, p in priced if lg.kind != "stock" and lg.qty < 0)
    opt = [(lg, k, p) for lg, k, p in priced if lg.kind != "stock"]
    # vertical width (defined risk) — for a condor only the wider side can lose
    width = 0.0
    for right in ("call", "put"):
        longs = [k for lg, k, p in opt if lg.kind == right and lg.qty > 0]
        shorts = [k for lg, k, p in opt if lg.kind == right and lg.qty < 0]
        side = 0.0
        if longs and shorts:
            for sh in shorts:
                nearest = min(longs, key=lambda x: abs(x - sh))
                side += abs(nearest - sh) * 100
        width = max(width, side)
    has_stock = any(lg.kind == "stock" and lg.qty > 0 for lg, k, p in priced)
    short_put_naked = any(lg.kind == "put" and lg.qty < 0 for lg, k, p in opt) and not any(
        lg.kind == "put" and lg.qty > 0 for lg, k, p in opt)
    if width > 0:
        return max(width - (short_opt - long_opt), long_opt - short_opt, 1.0)
    if short_put_naked:
        k = max(k for lg, k, p in opt if lg.kind == "put" and lg.qty < 0)
        return k * 100 - short_opt
    if has_stock:
        return spot * 100 - short_opt
    return max(long_opt - short_opt, 1.0)


def backtest_swing(symbol, strat_key, hold, target_pct, stop_pct, iv_map, days):
    s = strat.get(strat_key)
    legs = s.make_legs(1)
    trades = []
    i = 0
    while i + hold < len(days):
        d0 = days[i]
        iv = max(0.05, _iv_for(iv_map, d0.date))
        cal_days = (days[i + hold].date - d0.date).days
        t0 = max(cal_days, 1) / 365.0
        priced = _legs_priced(legs, d0.close, iv, t0)
        credit = sum((p * 100) for lg, k, p in priced if lg.kind != "stock" and lg.qty < 0) - \
                 sum((p * 100) for lg, k, p in priced if lg.kind != "stock" and lg.qty > 0)
        basis = abs(credit) if abs(credit) > 1e-9 else max(
            sum(p * 100 for lg, k, p in priced if lg.kind != "stock" and lg.qty > 0), 1.0)
        cap = _capital(priced, d0.close)

        exit_j, pnl = i + hold, None
        for j in range(i + 1, i + hold + 1):
            dj = days[j]
            t_rem = max((days[i + hold].date - dj.date).days, 0) / 365.0
            val = _value(priced, dj.close, iv, t_rem)
            if val >= target_pct * basis:
                exit_j, pnl = j, val
                break
            if val <= -stop_pct * basis:
                exit_j, pnl = j, val
                break
        if pnl is None:
            pnl = _value(priced, days[i + hold].close, iv, 0.0)  # expiry intrinsic
        trades.append({"pnl": pnl, "cap": cap, "credit": credit})
        i = exit_j  # non-overlapping
    return trades


def summarize_swing(trades, symbol, strat_key, hold):
    s = strat.get(strat_key)
    if len(trades) < 5:
        return None
    pnls = [t["pnl"] for t in trades]
    cap = sum(t["cap"] for t in trades) / len(trades)
    wins = [p for p in pnls if p > 0]
    n = len(pnls)
    mean = sum(pnls) / n
    var = sum((p - mean) ** 2 for p in pnls) / (n - 1) if n > 1 else 0
    std = math.sqrt(var)
    eq, peak, dd = 0.0, 0.0, 0.0
    for p in pnls:
        eq += p; peak = max(peak, eq); dd = min(dd, eq - peak)
    gross_w = sum(wins); gross_l = -sum(p for p in pnls if p < 0)
    total = sum(pnls)
    ret_on_cap = total / cap if cap else 0  # total return over the period per $cap
    calmar = (total / abs(dd)) if dd < 0 else (99.9 if total > 0 else 0)
    return {
        "symbol": symbol, "strategy": strat_key, "strategy_name": s.name,
        "cash_account_ok": s.cash_account_ok, "hold_days": hold, "trades": n,
        "win_rate": round(len(wins) / n, 3),
        "avg_pnl_per_trade": round(mean, 2),
        "capital_per_trade": round(cap, 0),
        "ret_per_trade_pct": round(mean / cap * 100, 2) if cap else 0,
        "total_pnl": round(total, 0),
        "total_return_on_capital_pct": round(ret_on_cap * 100, 1),
        "profit_factor": round(gross_w / gross_l, 2) if gross_l > 1e-9 else None,
        "max_drawdown": round(dd, 0),
        "return_dd": round(calmar, 2),
        "sharpe_per_trade": round(mean / std, 3) if std > 1e-9 else 0,
    }


def main():
    results = []
    strategies = ["cash_secured_put", "covered_call", "credit_spread", "iron_condor",
                  "long_call_put", "long_straddle"]
    for sym in ETFS:
        days = _daily(sym)
        ivm = _iv_map(sym)
        for sk in strategies:
            for hold in HOLDS:
                tgt, stp = (0.5, 2.0) if strat.get(sk).category in ("short_premium", "stock_option", "spread") else (1.0, 0.5)
                tr = backtest_swing(sym, sk, hold, tgt, stp, ivm, days)
                r = summarize_swing(tr, sym, sk, hold)
                if r:
                    results.append(r)
    results.sort(key=lambda r: r["return_dd"], reverse=True)
    print(f"{'sym':4} {'strategy':18} {'hold':>4} {'win':>5} {'ret/trade':>9} {'cap':>7} {'totRet%':>8} {'Ret/DD':>7} {'PF':>5} {'n':>4} legal")
    for r in results:
        print(f"{r['symbol']:4} {r['strategy']:18} {r['hold_days']:>4} {r['win_rate']:>5.0%} "
              f"{r['ret_per_trade_pct']:>8.1f}% ${r['capital_per_trade']:>6.0f} {r['total_return_on_capital_pct']:>7.0f}% "
              f"{r['return_dd']:>7.2f} {str(r['profit_factor']):>5} {r['trades']:>4} {'cash' if r['cash_account_ok'] else 'spread'}")
    import os
    out = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                       "src", "lib", "backtest", "swing.json")
    json.dump({"methodology": "Multi-day hold to expiry on daily bars (~2y). Exit = real "
               "underlying at expiry (intrinsic); only entry premium modeled. ETFs only.",
               "holds": HOLDS, "results": results}, open(out, "w"), indent=2)
    print(f"\nwrote {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
