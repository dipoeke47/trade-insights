"""Technical-indicator entry signals, computed intraday with NO look-ahead.

Each function looks only at bars[0..i] (entry bar = i) and returns a directional
bias: +1 (go long calls / bullish), -1 (long puts / bearish), or None (no clean
read -> skip the day). Used by the engine's signal dispatch.

Indicators: VWAP, MACD, Stochastic %K/%D, Stochastic Momentum Index (SMI), RSI,
EMA crossover — plus the original price-action signals (momentum, ORB).
"""
from __future__ import annotations

import math


def _ema(values: list[float], span: int) -> float | None:
    if len(values) < span:
        return None
    k = 2.0 / (span + 1.0)
    e = values[0]
    for v in values[1:]:
        e = v * k + e * (1.0 - k)
    return e


def _ema_series(values: list[float], span: int) -> list[float]:
    if not values:
        return []
    k = 2.0 / (span + 1.0)
    out = [values[0]]
    for v in values[1:]:
        out.append(v * k + out[-1] * (1.0 - k))
    return out


# --- individual indicators (return +1 / -1 / None) ------------------------

def vwap_dir(bars, i) -> int | None:
    """Price above session VWAP = bullish, below = bearish."""
    num = den = 0.0
    for b in bars[: i + 1]:
        tp = (b.high + b.low + b.close) / 3.0
        vol = b.volume if b.volume > 0 else 1.0
        num += tp * vol
        den += vol
    if den <= 0:
        return None
    vwap = num / den
    px = bars[i].close
    if abs(px - vwap) / vwap < 1e-4:
        return None
    return 1 if px > vwap else -1


def macd_dir(bars, i, fast=12, slow=26, signal=9) -> int | None:
    closes = [b.close for b in bars[: i + 1]]
    if len(closes) < slow + signal:
        return None
    ef = _ema_series(closes, fast)
    es = _ema_series(closes, slow)
    macd_line = [a - b for a, b in zip(ef, es)]
    sig = _ema_series(macd_line, signal)
    if not sig:
        return None
    hist = macd_line[-1] - sig[-1]
    if abs(hist) < 1e-9:
        return None
    return 1 if hist > 0 else -1


def stoch_dir(bars, i, k_period=14, d_period=3) -> int | None:
    if i + 1 < k_period + d_period:
        return None
    ks = []
    for j in range(i - d_period + 1, i + 1):
        window = bars[j - k_period + 1 : j + 1]
        hi = max(b.high for b in window)
        lo = min(b.low for b in window)
        if hi - lo < 1e-9:
            ks.append(50.0)
        else:
            ks.append((bars[j].close - lo) / (hi - lo) * 100.0)
    k = ks[-1]
    d = sum(ks) / len(ks)
    if abs(k - d) < 1e-6:
        return None
    return 1 if k > d else -1


def smi_dir(bars, i, period=14, smooth=3) -> int | None:
    """Stochastic Momentum Index: double-smoothed position within the range."""
    need = period + 2 * smooth
    if i + 1 < need:
        return None
    rel, rng = [], []
    for j in range(i - (period + 2 * smooth) + 1, i + 1):
        if j - period + 1 < 0:
            continue
        window = bars[j - period + 1 : j + 1]
        hi = max(b.high for b in window)
        lo = min(b.low for b in window)
        mid = (hi + lo) / 2.0
        rel.append(bars[j].close - mid)
        rng.append(hi - lo)
    if len(rel) < smooth + 1:
        return None
    rel_s = _ema_series(_ema_series(rel, smooth), smooth)
    rng_s = _ema_series(_ema_series(rng, smooth), smooth)
    if not rel_s or not rng_s or rng_s[-1] <= 0:
        return None
    smi = 100.0 * rel_s[-1] / (rng_s[-1] / 2.0)
    sig = _ema_series([100.0 * a / (b / 2.0) if b > 0 else 0.0
                       for a, b in zip(rel_s, rng_s)], smooth)
    if not sig:
        return None
    if abs(smi - sig[-1]) < 1e-6:
        return None
    return 1 if smi > sig[-1] else -1


def rsi_dir(bars, i, period=14) -> int | None:
    if i + 1 < period + 1:
        return None
    gains = losses = 0.0
    for j in range(i - period + 1, i + 1):
        ch = bars[j].close - bars[j - 1].close
        if ch >= 0:
            gains += ch
        else:
            losses -= ch
    if gains + losses < 1e-9:
        return None
    rs = gains / losses if losses > 1e-9 else 999.0
    rsi = 100.0 - 100.0 / (1.0 + rs)
    if abs(rsi - 50.0) < 1.0:
        return None
    return 1 if rsi > 50.0 else -1


def ema_cross_dir(bars, i, fast=9, slow=21) -> int | None:
    closes = [b.close for b in bars[: i + 1]]
    ef, es = _ema(closes, fast), _ema(closes, slow)
    if ef is None or es is None:
        return None
    if abs(ef - es) / es < 1e-4:
        return None
    return 1 if ef > es else -1


# --- price-action (kept from the original engine) -------------------------

def momentum_dir(bars, i) -> int | None:
    open_px, px = bars[0].open, bars[i].close
    if px > open_px:
        return 1
    if px < open_px:
        return -1
    return None


def orb_dir(bars, i, orb_minutes=30) -> int | None:
    window = [b for b in bars if b.minute_of_day <= bars[0].minute_of_day + orb_minutes]
    if not window:
        return None
    hi = max(b.high for b in window)
    lo = min(b.low for b in window)
    px = bars[i].close
    if px > hi:
        return 1
    if px < lo:
        return -1
    return None


DISPATCH = {
    "vwap": lambda bars, i, cfg: vwap_dir(bars, i),
    "macd": lambda bars, i, cfg: macd_dir(bars, i),
    "stoch": lambda bars, i, cfg: stoch_dir(bars, i),
    "smi": lambda bars, i, cfg: smi_dir(bars, i),
    "rsi": lambda bars, i, cfg: rsi_dir(bars, i),
    "ema_cross": lambda bars, i, cfg: ema_cross_dir(bars, i),
    "momentum": lambda bars, i, cfg: momentum_dir(bars, i),
    "orb": lambda bars, i, cfg: orb_dir(bars, i, getattr(cfg, "orb_minutes", 30)),
    "always": lambda bars, i, cfg: 1,
}

ALL_SIGNALS = list(DISPATCH.keys())
DIRECTIONAL_SIGNALS = [s for s in ALL_SIGNALS if s != "always"]
