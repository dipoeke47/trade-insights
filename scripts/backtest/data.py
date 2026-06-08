"""Intraday market data: fetch real underlying OHLCV + VIX from yfinance, cache
locally, and slice into per-day trading sessions for the backtester.

Cache lives in .backtest-cache.local/ (git-ignored, re-fetchable — not personal
data). yfinance intraday history limits drive the (interval -> max period) map.
"""
from __future__ import annotations

import math
import os
import pickle
import warnings
from dataclasses import dataclass, field
from datetime import date

import pandas as pd

# Trailing window (sessions) used to estimate each day's IV from the
# underlying's OWN realized volatility — see load_sessions().
REALIZED_VOL_WINDOW = 5
TRADING_DAYS_PER_YEAR = 252

warnings.filterwarnings("ignore")

CACHE_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    ".backtest-cache.local",
)

# yfinance intraday retention: 1m ~ last 8d, 5m/15m/30m/1h ~ last 60d
# (intraday beyond ~60d is unavailable on the free endpoint).
MAX_PERIOD_FOR_INTERVAL = {
    "1m": "5d",
    "5m": "60d",
    "15m": "60d",
    "30m": "60d",
    "1h": "60d",
    "60m": "60d",
}

# Regular US session in exchange-local time (yfinance intraday index is tz-aware
# America/New_York for US equities).
SESSION_OPEN = (9, 30)
SESSION_CLOSE = (16, 0)


@dataclass
class Bar:
    minute_of_day: int  # minutes since 00:00 exchange-local
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass
class Session:
    day: date
    bars: list[Bar]
    vix_open: float    # prior-day VIX close — regime context (display only)
    iv_base: float     # annualized IV estimate for pricing = trailing realized vol
    realized_vol: float  # this day's own realized vol (for diagnostics)
    # Tail of prior sessions' bars so multi-day indicators (MACD/RSI/…) are
    # warmed up by the open. Session-scoped signals (VWAP/momentum/ORB) ignore it.
    warmup: list = field(default_factory=list)

    def minute_index(self, minute_of_day: int) -> int:
        """Index of the first bar at/after the given minute_of_day; -1 if none."""
        for i, b in enumerate(self.bars):
            if b.minute_of_day >= minute_of_day:
                return i
        return -1


def _cache_path(symbol: str, interval: str, period: str) -> str:
    safe = symbol.replace("^", "_idx_")
    return os.path.join(CACHE_DIR, f"{safe}_{interval}_{period}.pkl")


def _download(symbol: str, interval: str, period: str) -> pd.DataFrame:
    import yfinance as yf

    df = yf.download(
        symbol, interval=interval, period=period, progress=False, auto_adjust=False
    )
    if df is None or df.empty:
        return pd.DataFrame()
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    return df


def fetch(symbol: str, interval: str, period: str, use_cache: bool = True) -> pd.DataFrame:
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = _cache_path(symbol, interval, period)
    if use_cache and os.path.exists(path):
        try:
            with open(path, "rb") as fh:
                return pickle.load(fh)
        except Exception:
            pass
    df = _download(symbol, interval, period)
    if not df.empty:
        with open(path, "wb") as fh:
            pickle.dump(df, fh)
    return df


def _vix_by_day(period: str, use_cache: bool = True) -> dict[date, float]:
    df = fetch("^VIX", "1d", period, use_cache=use_cache)
    out: dict[date, float] = {}
    if df.empty:
        return out
    for ts, row in df.iterrows():
        out[ts.date()] = float(row["Close"])
    return out


def load_sessions(
    symbol: str,
    interval: str = "5m",
    period: str | None = None,
    use_cache: bool = True,
) -> list[Session]:
    """Return one Session per trading day with intraday bars + a VIX regime read.

    VIX for a day = prior trading day's VIX close (information available at the
    open; avoids look-ahead).
    """
    if period is None:
        period = MAX_PERIOD_FOR_INTERVAL.get(interval, "60d")
    df = fetch(symbol, interval, period, use_cache=use_cache)
    if df.empty:
        return []

    # Need a slightly longer VIX window so the first day has a prior close.
    vix = _vix_by_day("90d" if period in ("60d", "90d") else period, use_cache=use_cache)
    vix_days = sorted(vix.keys())

    def prior_vix(day: date) -> float:
        prev = [d for d in vix_days if d < day]
        if prev:
            return vix[prev[-1]]
        same = [d for d in vix_days if d <= day]
        return vix[same[-1]] if same else 18.0

    sessions: list[Session] = []
    open_min = SESSION_OPEN[0] * 60 + SESSION_OPEN[1]
    close_min = SESSION_CLOSE[0] * 60 + SESSION_CLOSE[1]

    for day, group in df.groupby(df.index.date):
        bars: list[Bar] = []
        for ts, row in group.iterrows():
            mod = ts.hour * 60 + ts.minute
            if mod < open_min or mod > close_min:
                continue  # drop pre/post-market stragglers
            try:
                o, h, l, c, v = (
                    float(row["Open"]), float(row["High"]), float(row["Low"]),
                    float(row["Close"]), float(row.get("Volume", 0) or 0),
                )
            except (ValueError, TypeError):
                continue
            if any(x != x for x in (o, h, l, c)):  # NaN guard
                continue
            bars.append(Bar(mod, o, h, l, c, v))
        if len(bars) < 10:  # skip half-days / sparse sessions
            continue
        sessions.append(Session(day=day, bars=bars, vix_open=prior_vix(day),
                                iv_base=0.0, realized_vol=0.0))

    sessions.sort(key=lambda s: s.day)
    _assign_iv(sessions, symbol)
    # Warm up multi-day indicators: each session sees the last 60 bars of the
    # preceding sessions (a continuous intraday series, as live indicators use).
    acc: list[Bar] = []
    for sess in sessions:
        sess.warmup = acc[-60:]
        acc.extend(sess.bars)
    return sessions


def _intraday_realized_vol(bars: list[Bar]) -> float:
    """Annualized realized vol from intraday squared log-returns (one session)."""
    closes = [b.close for b in bars if b.close > 0]
    rets = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes))]
    if len(rets) < 2:
        return 0.0
    daily_var = sum(r * r for r in rets)  # realized variance for the day
    return math.sqrt(max(daily_var, 0.0) * TRADING_DAYS_PER_YEAR)


# SPY's median intraday realized vol — the reference the IV anchor scales from.
_SPY_REF: float | None = None


def _spy_ref_realized(use_cache: bool = True) -> float:
    """Median intraday realized vol of SPY (a stable scaling reference).

    Computed straight from SPY bars (NOT via load_sessions) to avoid recursion.
    """
    global _SPY_REF
    if _SPY_REF is not None:
        return _SPY_REF
    df = fetch("SPY", "5m", MAX_PERIOD_FOR_INTERVAL["5m"], use_cache=use_cache)
    rvs: list[float] = []
    if not df.empty:
        open_min = SESSION_OPEN[0] * 60 + SESSION_OPEN[1]
        close_min = SESSION_CLOSE[0] * 60 + SESSION_CLOSE[1]
        for _day, group in df.groupby(df.index.date):
            bars = []
            for ts, row in group.iterrows():
                mod = ts.hour * 60 + ts.minute
                if open_min <= mod <= close_min:
                    try:
                        bars.append(Bar(mod, 0, 0, 0, float(row["Close"]), 0))
                    except (ValueError, TypeError):
                        pass
            if len(bars) >= 10:
                v = _intraday_realized_vol(bars)
                if v > 0:
                    rvs.append(v)
    _SPY_REF = (sorted(rvs)[len(rvs) // 2]) if rvs else 0.10
    return _SPY_REF


def _assign_iv(sessions: list[Session], symbol: str) -> None:
    """Set each session's pricing IV, anchored to the real VIX level.

    IV = (VIX/100) x (symbol_realized / SPY_realized) x  ... where the realized
    *ratio* captures how much more/less volatile this underlying is than SPY.
    Anchoring the absolute level to VIX (a real, traded implied vol) fixes the
    structural understatement of intraday realized vol; the ratio (where the
    understatement cancels) fixes cross-asset mispricing. Uses trailing realized
    + prior-day VIX -> no look-ahead.
    """
    rv = [_intraday_realized_vol(s.bars) for s in sessions]
    spy_ref = _spy_ref_realized()
    # This symbol's own median realized — its ratio vs SPY is the vol multiple.
    own = sorted([v for v in rv if v > 0])
    own_ref = own[len(own) // 2] if own else spy_ref
    vol_ratio = max(0.25, min(8.0, own_ref / spy_ref)) if spy_ref > 0 else 1.0

    for i, s in enumerate(sessions):
        s.realized_vol = rv[i]
        prior = [v for v in rv[max(0, i - REALIZED_VOL_WINDOW):i] if v > 0]
        trailing = (sum(prior) / len(prior)) if prior else own_ref
        # Day's vol multiple = blend of the symbol's structural ratio and its
        # recent trailing realized relative to SPY's reference.
        day_ratio = max(0.25, min(8.0, 0.5 * vol_ratio + 0.5 * (trailing / spy_ref)))
        s.iv_base = max(0.05, (s.vix_open / 100.0) * day_ratio)
