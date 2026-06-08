"""Strategy definitions for the intraday options backtester.

Each strategy is a set of option/stock legs constructed at entry from the spot
price and (optionally) a directional signal. `cash_account_ok` flags whether the
strategy is executable in a $1k cash account (the user's constraint) — spreads,
naked shorts and short stock are backtested for completeness but flagged.

Conventions
- Option leg qty: +1 long / -1 short, in contracts, *per unit*.
- Stock leg qty: +1 / -1 in 100-share blocks, *per unit* (for covered/secured).
- moneyness: strike = round_strike(spot * (1 + moneyness)). 0.0 = ATM.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable


@dataclass(frozen=True)
class Leg:
    kind: str          # 'call' | 'put' | 'stock'
    qty: int           # +long / -short per unit
    moneyness: float = 0.0


@dataclass(frozen=True)
class Strategy:
    key: str
    name: str
    category: str       # long_premium | short_premium | spread | stock_option
    cash_account_ok: bool
    direction_aware: bool
    make_legs: Callable[[int], list[Leg]]  # direction (+1/-1) -> legs
    # exit defaults (overridable from run config)
    default_target_pct: float = 0.5
    default_stop_pct: float = 0.5
    notes: str = ""
    tags: list[str] = field(default_factory=list)


def _round_strike(spot: float) -> float:
    return 1.0 if spot >= 50 else (0.5 if spot >= 10 else 0.5)


def round_to_strike(spot: float, moneyness: float) -> float:
    raw = spot * (1.0 + moneyness)
    inc = _round_strike(spot)
    return round(raw / inc) * inc


# --- registry -------------------------------------------------------------

def _long_directional(direction: int) -> list[Leg]:
    # Buy an ATM call (bullish) or ATM put (bearish) — the signal picks side.
    return [Leg("call" if direction > 0 else "put", +1, 0.0)]


def _long_otm_directional(direction: int) -> list[Leg]:
    return [Leg("call" if direction > 0 else "put", +1, 0.004 * direction)]


def _long_straddle(_d: int) -> list[Leg]:
    return [Leg("call", +1, 0.0), Leg("put", +1, 0.0)]


def _long_strangle(_d: int) -> list[Leg]:
    return [Leg("call", +1, +0.006), Leg("put", +1, -0.006)]


def _csp(_d: int) -> list[Leg]:
    # Sell a slightly-OTM put, cash-secured (collateral = strike*100).
    return [Leg("put", -1, -0.005)]


def _covered_call(_d: int) -> list[Leg]:
    return [Leg("stock", +1, 0.0), Leg("call", -1, +0.005)]


def _covered_put(_d: int) -> list[Leg]:
    # Short stock + short put (margin/short — not cash-account legal).
    return [Leg("stock", -1, 0.0), Leg("put", -1, -0.005)]


def _bull_call_spread(direction: int) -> list[Leg]:
    if direction > 0:
        return [Leg("call", +1, 0.0), Leg("call", -1, +0.006)]
    return [Leg("put", +1, 0.0), Leg("put", -1, -0.006)]


def _credit_spread(direction: int) -> list[Leg]:
    # Sell ATM, buy further OTM as a wing — bull put (up) / bear call (down).
    if direction > 0:
        return [Leg("put", -1, -0.002), Leg("put", +1, -0.010)]
    return [Leg("call", -1, +0.002), Leg("call", +1, +0.010)]


def _iron_condor(_d: int) -> list[Leg]:
    return [
        Leg("put", -1, -0.006), Leg("put", +1, -0.014),
        Leg("call", -1, +0.006), Leg("call", +1, +0.014),
    ]


REGISTRY: dict[str, Strategy] = {
    s.key: s
    for s in [
        Strategy(
            "long_call_put", "Long Call / Put (directional 0DTE)", "long_premium",
            cash_account_ok=True, direction_aware=True, make_legs=_long_directional,
            default_target_pct=0.6, default_stop_pct=0.4,
            notes="Buy ATM call if signal up, ATM put if down. Pure intraday direction + gamma.",
            tags=["0DTE", "directional", "affordable"],
        ),
        Strategy(
            "long_otm", "Long OTM Call / Put (lotto 0DTE)", "long_premium",
            cash_account_ok=True, direction_aware=True, make_legs=_long_otm_directional,
            default_target_pct=1.0, default_stop_pct=0.6,
            notes="Cheaper OTM long — higher leverage, lower win rate.",
            tags=["0DTE", "directional", "affordable"],
        ),
        Strategy(
            "long_straddle", "Long Straddle (ATM call+put)", "long_premium",
            cash_account_ok=True, direction_aware=False, make_legs=_long_straddle,
            default_target_pct=0.4, default_stop_pct=0.4,
            notes="Non-directional breakout/volatility. Needs a big intraday move to beat theta.",
            tags=["0DTE", "volatility"],
        ),
        Strategy(
            "long_strangle", "Long Strangle (OTM call+put)", "long_premium",
            cash_account_ok=True, direction_aware=False, make_legs=_long_strangle,
            default_target_pct=0.6, default_stop_pct=0.5,
            notes="Cheaper non-directional breakout play.",
            tags=["0DTE", "volatility", "affordable"],
        ),
        Strategy(
            "cash_secured_put", "Cash-Secured Put (sell put)", "short_premium",
            cash_account_ok=True, direction_aware=False, make_legs=_csp,
            default_target_pct=0.5, default_stop_pct=2.0,
            notes="Sell OTM put, collateral=strike*100. Only fits $1k acct on sub-$10 underlyings.",
            tags=["theta", "premium-selling"],
        ),
        Strategy(
            "covered_call", "Covered Call (100sh + short call)", "stock_option",
            cash_account_ok=True, direction_aware=False, make_legs=_covered_call,
            default_target_pct=0.5, default_stop_pct=2.0,
            notes="Needs 100 shares — only sub-$10 underlyings fit $1k. Premium tiny there.",
            tags=["theta", "premium-selling", "capital-heavy"],
        ),
        Strategy(
            "covered_put", "Covered/Short Put (short 100sh + short put)", "stock_option",
            cash_account_ok=False, direction_aware=False, make_legs=_covered_put,
            default_target_pct=0.5, default_stop_pct=2.0,
            notes="Requires shorting stock — NOT allowed in a cash account. Backtest-only.",
            tags=["theta", "margin-only"],
        ),
        Strategy(
            "debit_spread", "Vertical Debit Spread (bull call / bear put)", "spread",
            cash_account_ok=False, direction_aware=True, make_legs=_bull_call_spread,
            default_target_pct=0.6, default_stop_pct=0.5,
            notes="Spreads need spread-level approval — flagged as not cash-account-legal per user.",
            tags=["0DTE", "directional", "defined-risk"],
        ),
        Strategy(
            "credit_spread", "Vertical Credit Spread (bull put / bear call)", "spread",
            cash_account_ok=False, direction_aware=True, make_legs=_credit_spread,
            default_target_pct=0.5, default_stop_pct=1.5,
            notes="Defined-risk premium selling. Spread approval required (backtest-only).",
            tags=["0DTE", "theta", "defined-risk"],
        ),
        Strategy(
            "iron_condor", "Iron Condor (0DTE)", "spread",
            cash_account_ok=False, direction_aware=False, make_legs=_iron_condor,
            default_target_pct=0.4, default_stop_pct=1.5,
            notes="Range-bound premium selling. Spread approval required (backtest-only).",
            tags=["0DTE", "theta", "defined-risk"],
        ),
    ]
}


def get(key: str) -> Strategy:
    if key not in REGISTRY:
        raise KeyError(f"unknown strategy '{key}'. Known: {list(REGISTRY)}")
    return REGISTRY[key]


def all_keys() -> list[str]:
    return list(REGISTRY)
