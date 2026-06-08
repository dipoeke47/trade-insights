# Intraday Options Strategy Backtester

A from-scratch, dependency-light engine that backtests **same-day open/close**
options strategies (the constraint of a cash account) and ranks them by
**consistent daily profitability**. It powers the `/backtest` dashboard.

## ⚠️ The honesty caveat (read this)

**Free historical _option_ prices do not exist.** Intraday option chains
(bid/ask per strike, per minute, going back months) are a paid data product.
So this engine **models** option prices instead of using real quotes:

- **Underlying** = real intraday OHLCV from yfinance (5-minute bars, ~60 days).
- **Options** = priced with **Black-Scholes** from the live underlying path.
- **Implied vol** = anchored to the **real VIX level** (a traded implied vol),
  then scaled per-symbol by each underlying's realized-vol *ratio* to SPY — so
  IWM/QQQ/single-names get their own (higher) IV instead of borrowing the S&P's.
- **Fills** = mid ± a modeled half-spread; **fees** = per-contract, per side.

This is **good for ranking strategies against each other** and understanding
their *shape* (win rate, tail risk, theta drag). It is **approximate for
absolute dollars** and is **not a prediction**. A backtested edge routinely
vanishes in live trading. Nothing here is financial advice.

### Why modeling honestly matters

An early version priced every symbol's options off `^VIX`. Because VIX only
measures S&P vol, it **underpriced** options on more-volatile underlyings (IWM,
single names), making long straddles look like they printed +$436/day at an 87%
win rate. That was a **mispricing artifact**. Anchoring IV to the real VIX level
+ per-symbol realized-vol scaling fixed it — and the "edge" correctly collapsed
to break-even/negative. If a result looks too good, suspect the IV assumption
first (the UI exposes it as a slider so you can see the sensitivity yourself).

## What it found (this sample)

1. **No free lunch in long premium.** At realistic IV, buying calls/puts/
   straddles/strangles is break-even to negative after theta + slippage + fees.
2. **The edge is in _selling_ defined-risk premium.** 0DTE credit spreads on
   SPY/QQQ were the only **broadly out-of-sample-robust** winners (76–82% win
   days, many surviving param sets). But they need **spread approval** — which a
   cash account doesn't have.
3. **Affordable + cash-legal "winners" are mostly leveraged market drift.** The
   directional longs that survived did so largely because the sample trended up,
   not from a durable intraday edge. Paper-trade before risking real money.
4. **CSP / covered calls don't fit $1k.** Collateral = strike × 100, so even a
   $15 stock needs $1,500. Only sub-$10 names fit, and there the premium is tiny
   and the same-day theta capture is negligible (no true 0DTE).

## Architecture

| File | Role |
|---|---|
| `pricing.py` | Black-Scholes price + greeks (intrinsic floor for 0DTE into the close) |
| `data.py` | yfinance fetch + cache, per-day sessions, VIX-anchored IV estimate |
| `strategies.py` | Strategy registry (legs, cash-account legality, exit defaults) |
| `engine.py` | Per-session simulation: signal → size → intraday exits → P&L |
| `metrics.py` | Daily-profitability stats + the consistency score |
| `rank_all.py` | Sweep the full grid → `src/lib/backtest/ranked.json` |
| `optimize.py` | Train/test parameter search → `src/lib/backtest/optimized.json` |
| `run.py` | Run one config, print JSON (used by `/api/backtest`) |

## Running

```bash
# from repo root, with the venv set up (see top-level README)
.venv/bin/python -m scripts.backtest.rank_all      # refresh the leaderboard
.venv/bin/python -m scripts.backtest.optimize      # refresh out-of-sample search
.venv/bin/python -m scripts.backtest.run '{"symbol":"SPY","strategy":"long_call_put"}'

# or via npm
npm run backtest:rank
npm run backtest:optimize
```

Market data is cached in `.backtest-cache.local/` (git-ignored, re-fetchable).

## Modeling assumptions (all tunable in `RunConfig`)

- Time-to-expiry in **calendar** time; 0DTE → intrinsic at 16:00.
- IV = `iv_multiplier` × (VIX-anchored, per-symbol-scaled) vol. Default 1.2×
  (0DTE trades richer than the 30-day VIX).
- Half-spread = `max(0.01, slippage_frac × mid)` per side; `contract_fee` per
  side; small bps slippage on stock legs.
- Position sizing fills the account by per-unit capital (debit / collateral /
  defined-risk), capped at `max_units` for liquidity sanity.
- Signals: `momentum` (vs the open), `orb` (opening-range breakout), `always`.
- **No look-ahead:** IV uses prior-day VIX + trailing realized vol; exits use
  bar-by-bar marks going forward only.

## Limitations

- ~60 trading days of 5-minute bars (yfinance intraday retention). Small sample
  → the score discounts low trade counts, but regimes still dominate.
- No early assignment, no dividends/borrow, no real liquidity/queue modeling.
- Same-day expiry is assumed available; only SPY/QQQ/IWM truly have daily 0DTE.
