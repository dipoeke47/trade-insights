"""Intraday backtest engine.

For each trading session: optionally apply an entry signal, build the strategy's
legs at the entry bar, size them to the account, then walk bars forward applying
profit-target / stop / time-exit rules. Option legs are priced with Black-Scholes
from the real underlying path + a VIX-derived IV. Slippage + fees are charged on
every fill. Output is a per-day P&L series the metrics layer ranks.

MODEL, NOT REAL FILLS — see scripts/backtest/README.md for the honesty caveats.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from . import strategies as strat
from .data import Session
from .pricing import price_option

CLOSE_MIN = 16 * 60  # 16:00 expiry for same-day (0DTE) options


@dataclass
class RunConfig:
    symbol: str = "SPY"
    strategy: str = "long_call_put"
    interval: str = "5m"
    period: str | None = None
    account_size: float = 1000.0
    entry_minute: int = 9 * 60 + 40       # 9:40 ET
    time_exit_minute: int = 15 * 60 + 55  # 15:55 ET (avoid pin risk)
    dte: int = 0                          # 0 = same-day expiry
    # IV-over-realized premium: options are priced at iv_multiplier x the
    # underlying's trailing realized vol. Real options trade at IV >= realized
    # (variance risk premium), so >1.0 is fair. Long-premium P&L is extremely
    # sensitive to this — the UI exposes it as a slider.
    iv_multiplier: float = 1.2
    rate: float = 0.04
    slippage_frac: float = 0.01           # half-spread as fraction of option mid
    option_min_halfspread: float = 0.01   # floor on half-spread, per share
    stock_halfspread_bps: float = 1.0     # stock slippage in basis points of price
    contract_fee: float = 0.03            # per option contract, per side
    signal: str = "momentum"              # momentum | orb | always
    orb_minutes: int = 30                 # opening-range window for 'orb'
    target_pct: float | None = None       # override strategy default
    stop_pct: float | None = None
    max_units: int = 50                   # liquidity sanity cap

    def resolved_targets(self) -> tuple[float, float]:
        s = strat.get(self.strategy)
        t = self.target_pct if self.target_pct is not None else s.default_target_pct
        st = self.stop_pct if self.stop_pct is not None else s.default_stop_pct
        return t, st


@dataclass
class DayResult:
    day: str
    traded: bool
    direction: int
    units: int
    capital_required: float       # per-unit at-risk capital
    pnl: float                    # sized $ P&L for the day
    pnl_per_unit: float
    return_pct: float             # pnl / capital deployed
    exit_reason: str
    affordable: bool


@dataclass
class BacktestResult:
    config: dict
    strategy_name: str
    cash_account_ok: bool
    notes: str
    symbol: str
    days: list[DayResult] = field(default_factory=list)
    error: str | None = None


# --- pricing helpers ------------------------------------------------------

def _minutes_to_expiry(current_min: int, dte: int) -> float:
    return dte * 1440 + (CLOSE_MIN - current_min)


def _leg_strike(leg: strat.Leg, entry_spot: float) -> float:
    if leg.kind == "stock":
        return 0.0
    return strat.round_to_strike(entry_spot, leg.moneyness)


def _option_mid(leg: strat.Leg, strike: float, spot: float, current_min: int,
                iv: float, cfg: RunConfig) -> float:
    return price_option(
        spot, strike, _minutes_to_expiry(current_min, cfg.dte),
        iv, is_call=(leg.kind == "call"), rate=cfg.rate,
    )


def _half_spread(mid: float, cfg: RunConfig) -> float:
    return max(cfg.option_min_halfspread, cfg.slippage_frac * mid)


# --- signal ---------------------------------------------------------------

def _direction(session: Session, entry_idx: int, cfg: RunConfig) -> int | None:
    """+1 / -1 directional bias, or None to skip the day."""
    bars = session.bars
    open_px = bars[0].open
    entry_px = bars[entry_idx].close
    if cfg.signal == "always":
        return 1
    if cfg.signal == "momentum":
        if entry_px > open_px:
            return 1
        if entry_px < open_px:
            return -1
        return None
    if cfg.signal == "orb":
        window = [b for b in bars if b.minute_of_day <= bars[0].minute_of_day + cfg.orb_minutes]
        if not window:
            return None
        hi = max(b.high for b in window)
        lo = min(b.low for b in window)
        if entry_px > hi:
            return 1
        if entry_px < lo:
            return -1
        return None
    return 1


# --- core simulation ------------------------------------------------------

def _capital_required(legs, prices, strikes, entry_spot: float) -> tuple[float, float]:
    """Return (capital_required_per_unit, pnl_basis_per_unit).

    capital_required = cash needed to hold the position in a cash/secured sense.
    pnl_basis = the natural denominator for target/stop % (net premium debit or
    credit). Both per single unit (1 contract per option leg).
    """
    long_opt = sum(prices[i] * 100 for i, lg in enumerate(legs)
                   if lg.kind != "stock" and lg.qty > 0)
    short_opt = sum(prices[i] * 100 for i, lg in enumerate(legs)
                    if lg.kind != "stock" and lg.qty < 0)
    stock_cost = sum(entry_spot * 100 for lg in legs if lg.kind == "stock" and lg.qty > 0)
    short_stock = any(lg.kind == "stock" and lg.qty < 0 for lg in legs)

    net_premium = short_opt - long_opt  # >0 credit, <0 debit
    pnl_basis = abs(net_premium) if abs(net_premium) > 1e-9 else max(long_opt, 1.0)

    # Vertical spread? (a long + short of the same right) -> defined risk = width.
    # For a condor only ONE side can finish ITM, so risk = the wider single side,
    # not the sum of both wings.
    opt_legs = [(i, lg) for i, lg in enumerate(legs) if lg.kind != "stock"]
    width_collateral = 0.0
    for right in ("call", "put"):
        longs = [strikes[i] for i, lg in opt_legs if lg.kind == right and lg.qty > 0]
        shorts = [strikes[i] for i, lg in opt_legs if lg.kind == right and lg.qty < 0]
        side_width = 0.0
        for sk in shorts:
            if longs:
                nearest = min(longs, key=lambda lk: abs(lk - sk))
                side_width += abs(nearest - sk) * 100
        width_collateral = max(width_collateral, side_width)

    # Naked short puts (no long wing) -> cash-secured collateral.
    csp_collateral = 0.0
    for i, lg in opt_legs:
        if lg.kind == "put" and lg.qty < 0:
            has_wing = any(legs[j].kind == "put" and legs[j].qty > 0 for j, _ in opt_legs)
            if not has_wing:
                csp_collateral += strikes[i] * 100

    if width_collateral > 0:                         # spread: defined-risk
        capital = max(long_opt - short_opt, width_collateral - net_premium, 1.0)
    elif csp_collateral > 0:                         # cash-secured put
        capital = csp_collateral - short_opt
    elif stock_cost > 0:                             # covered call: buy the shares
        capital = stock_cost - short_opt
    elif short_stock:                                # short stock + short put (margin)
        capital = entry_spot * 100 + (short_opt if short_opt else 0.0)
    else:                                            # plain long premium
        capital = max(long_opt - short_opt, 1.0)

    return max(capital, 1.0), pnl_basis


def simulate_session(session: Session, cfg: RunConfig) -> DayResult:
    s = strat.get(cfg.strategy)
    target_pct, stop_pct = cfg.resolved_targets()
    # Price options off THIS underlying's own trailing realized vol (×iv premium),
    # not a borrowed S&P index — otherwise high-vol names look falsely profitable.
    iv = max(0.03, session.iv_base * cfg.iv_multiplier)

    entry_idx = session.minute_index(cfg.entry_minute)
    day = session.day.isoformat()
    flat = DayResult(day, False, 0, 0, 0.0, 0.0, 0.0, 0.0, "no-signal", True)
    if entry_idx < 0:
        return flat

    direction = _direction(session, entry_idx, cfg) if s.direction_aware else 1
    if direction is None:
        return flat

    legs = s.make_legs(direction)
    entry_bar = session.bars[entry_idx]
    entry_spot = entry_bar.close
    strikes = [_leg_strike(lg, entry_spot) for lg in legs]

    # Entry fills (slippage: buy high / sell low).
    entry_fills: list[float] = []
    mids_at_entry: list[float] = []
    for i, lg in enumerate(legs):
        if lg.kind == "stock":
            hs = entry_spot * cfg.stock_halfspread_bps / 1e4
            fill = entry_spot + hs if lg.qty > 0 else entry_spot - hs
            entry_fills.append(fill)
            mids_at_entry.append(entry_spot)
        else:
            mid = _option_mid(lg, strikes[i], entry_spot, entry_bar.minute_of_day, iv, cfg)
            hs = _half_spread(mid, cfg)
            fill = mid + hs if lg.qty > 0 else mid - hs
            entry_fills.append(max(fill, 0.0))
            mids_at_entry.append(mid)

    capital_req, pnl_basis = _capital_required(legs, mids_at_entry, strikes, entry_spot)
    units = min(cfg.max_units, int(cfg.account_size // capital_req))
    affordable = units >= 1
    if not affordable:
        # Position doesn't fit the account — record as a non-trade so it doesn't
        # masquerade as a flat $0 day. The summary then flags it unaffordable.
        return DayResult(day, False, direction, 0, capital_req, 0.0, 0.0, 0.0,
                         "unaffordable", False)

    def unit_pnl_at(bar_idx: int, use_slippage: bool) -> float:
        bar = session.bars[bar_idx]
        spot = bar.close
        total = 0.0
        for i, lg in enumerate(legs):
            if lg.kind == "stock":
                hs = spot * cfg.stock_halfspread_bps / 1e4 if use_slippage else 0.0
                exit_fill = spot - hs if lg.qty > 0 else spot + hs
            else:
                mid = _option_mid(lg, strikes[i], spot, bar.minute_of_day, iv, cfg)
                hs = _half_spread(mid, cfg) if use_slippage else 0.0
                exit_fill = (mid - hs) if lg.qty > 0 else (mid + hs)
                exit_fill = max(exit_fill, 0.0)
            mult = 100
            if lg.qty > 0:
                total += (exit_fill - entry_fills[i]) * mult
            else:
                total += (entry_fills[i] - exit_fill) * mult
        # fees: each option leg trades on entry + exit.
        opt_legs = sum(1 for lg in legs if lg.kind != "stock")
        total -= opt_legs * 2 * cfg.contract_fee
        return total

    # Walk forward to find the exit.
    exit_idx = len(session.bars) - 1
    exit_reason = "time"
    target_val = target_pct * pnl_basis
    stop_val = stop_pct * pnl_basis
    for bidx in range(entry_idx + 1, len(session.bars)):
        bar = session.bars[bidx]
        if bar.minute_of_day >= cfg.time_exit_minute:
            exit_idx, exit_reason = bidx, "time"
            break
        pnl_mid = unit_pnl_at(bidx, use_slippage=False)
        if pnl_mid >= target_val:
            exit_idx, exit_reason = bidx, "target"
            break
        if pnl_mid <= -stop_val:
            exit_idx, exit_reason = bidx, "stop"
            break

    realized_per_unit = unit_pnl_at(exit_idx, use_slippage=True)
    sized_pnl = realized_per_unit * units
    deployed = capital_req * units
    return_pct = (sized_pnl / deployed) if deployed > 0 else 0.0

    return DayResult(
        day=day, traded=True, direction=direction, units=units,
        capital_required=capital_req, pnl=sized_pnl,
        pnl_per_unit=realized_per_unit, return_pct=return_pct,
        exit_reason=exit_reason, affordable=affordable,
    )


def run_backtest(sessions: list[Session], cfg: RunConfig) -> BacktestResult:
    s = strat.get(cfg.strategy)
    res = BacktestResult(
        config=cfg.__dict__, strategy_name=s.name, cash_account_ok=s.cash_account_ok,
        notes=s.notes, symbol=cfg.symbol,
    )
    if not sessions:
        res.error = "no sessions (data fetch failed or empty)"
        return res
    for sess in sessions:
        try:
            res.days.append(simulate_session(sess, cfg))
        except Exception as e:  # one bad day shouldn't kill the run
            res.days.append(DayResult(sess.day.isoformat(), False, 0, 0, 0.0, 0.0,
                                      0.0, 0.0, f"error:{e}", True))
    return res
