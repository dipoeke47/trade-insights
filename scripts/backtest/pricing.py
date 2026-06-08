"""Black-Scholes option pricing + greeks.

Used to *model* option prices from real underlying intraday data, because free
historical option-chain data does not exist. This is a transparent model, not
real fills — good for ranking strategies against each other, approximate for
absolute dollars. See README in this folder for the honesty caveats.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

SQRT_2PI = math.sqrt(2.0 * math.pi)

# Calendar minutes in a 365-day year — time-to-expiry is measured in calendar
# time (standard for BS), even for 0DTE where T shrinks through the session.
MINUTES_PER_YEAR = 365.0 * 24.0 * 60.0


def _norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _norm_pdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / SQRT_2PI


@dataclass(frozen=True)
class Greeks:
    price: float
    delta: float
    gamma: float
    theta: float  # per day
    vega: float   # per 1.00 (100%) vol move


def black_scholes(
    spot: float,
    strike: float,
    t_years: float,
    iv: float,
    is_call: bool,
    rate: float = 0.04,
) -> Greeks:
    """Price one option (per share) + greeks.

    At/after expiry (t<=0) or zero vol, returns intrinsic value with degenerate
    greeks — this matters for 0DTE held into the close.
    """
    intrinsic = max(0.0, (spot - strike) if is_call else (strike - spot))
    if t_years <= 0 or iv <= 0 or spot <= 0:
        delta = 0.0
        if is_call and spot > strike:
            delta = 1.0
        elif (not is_call) and spot < strike:
            delta = -1.0
        return Greeks(price=intrinsic, delta=delta, gamma=0.0, theta=0.0, vega=0.0)

    sqrt_t = math.sqrt(t_years)
    d1 = (math.log(spot / strike) + (rate + 0.5 * iv * iv) * t_years) / (iv * sqrt_t)
    d2 = d1 - iv * sqrt_t
    disc = math.exp(-rate * t_years)

    if is_call:
        price = spot * _norm_cdf(d1) - strike * disc * _norm_cdf(d2)
        delta = _norm_cdf(d1)
        theta_annual = (
            -(spot * _norm_pdf(d1) * iv) / (2 * sqrt_t)
            - rate * strike * disc * _norm_cdf(d2)
        )
    else:
        price = strike * disc * _norm_cdf(-d2) - spot * _norm_cdf(-d1)
        delta = _norm_cdf(d1) - 1.0
        theta_annual = (
            -(spot * _norm_pdf(d1) * iv) / (2 * sqrt_t)
            + rate * strike * disc * _norm_cdf(-d2)
        )

    gamma = _norm_pdf(d1) / (spot * iv * sqrt_t)
    vega = spot * _norm_pdf(d1) * sqrt_t  # per 1.00 vol
    theta = theta_annual / 365.0  # per calendar day

    # Never let the model price below intrinsic (no-arb floor).
    price = max(price, intrinsic)
    return Greeks(price=price, delta=delta, gamma=gamma, theta=theta, vega=vega)


def t_years_from_minutes(minutes_to_expiry: float) -> float:
    return max(0.0, minutes_to_expiry) / MINUTES_PER_YEAR


def price_option(
    spot: float,
    strike: float,
    minutes_to_expiry: float,
    iv: float,
    is_call: bool,
    rate: float = 0.04,
) -> float:
    return black_scholes(
        spot, strike, t_years_from_minutes(minutes_to_expiry), iv, is_call, rate
    ).price
