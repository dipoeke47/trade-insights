#!/usr/bin/env python3
"""
Rebuild the primary account's activity in .rh-snapshot.local.json from your REAL,
FULL Robinhood history (stocks + options) via robin_stocks — so realized P&L and
the date-range views are complete and consistent across both asset classes.

WHY THIS EXISTS
---------------
The official Robinhood *agent* MCP is equities-only in beta and paginates, so it
gave a capped equity slice and no options. robin_stocks talks to Robinhood's
classic private API (api.robinhood.com), which exposes the *full* order history
for both stocks (get_all_stock_orders) and options (get_all_option_orders). This
is the UNOFFICIAL API: it can change without notice and is a ToS gray area — use
on your own account only.

WHAT IT WRITES (into EACH account — orders are fetched per account_number)
--------------------------------------------------------------------------
- transactions[]   full stock + option transaction history (windowed by the UI)
- realizedEvents[] full realized-P&L events by date (stocks via FIFO; options via
                   net cashflow on fully-closed contracts) — summed/curved per range
- orders[]         the most recent 40, for the table fallback
- pnlSeries[]      cumulative realized over all history (the "ALL" range view)
- dailyTrades[]    fills per day over all history
- portfolio.totalPnl  combined realized P&L
Account *balances* (value, cash, buying power, options value) are left as-is —
they're point-in-time from the agent MCP and have no historical series.

USAGE
-----
    pip install -r scripts/requirements.txt        # robin_stocks, pyotp
    # RH_* creds in .env.local (git-ignored) — auto-loaded; prompted on first run
    npm run snapshot

NOTE: I (the author) could not run this — it needs your login. Raw orders are
dumped to .rh-orders.local.json; if a number looks off, paste me one entry
(especially a multi-leg option) and I'll tune the parser to your data shape.
"""
import os
import sys
import json
import datetime as dt
from collections import defaultdict, deque

try:
    import robin_stocks.robinhood as rh
except ImportError:
    sys.exit("Missing deps. Run: pip install -r scripts/requirements.txt")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAP = os.path.join(ROOT, ".rh-snapshot.local.json")
RAW = os.path.join(ROOT, ".rh-orders.local.json")
# Which snapshot account to attach history to. Optional — defaults to the first
# account in the snapshot, so the repo carries no personal account number.
PRIMARY = os.environ.get("RH_PRIMARY_ACCOUNT")

FILLED = "filled"
CANCELLED = {"cancelled", "rejected", "failed", "voided"}


def load_dotenv():
    """Load .env.local into the environment (real env vars take precedence)."""
    path = os.path.join(ROOT, ".env.local")
    if not os.path.exists(path):
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key, val = key.strip(), val.strip().strip("'\"")
            if " #" in val:
                val = val.split(" #", 1)[0].strip()
            if key and key not in os.environ:
                os.environ[key] = val


def persist_env(updates):
    """Write/update keys in .env.local without clobbering other entries."""
    path = os.path.join(ROOT, ".env.local")
    lines = open(path).read().splitlines() if os.path.exists(path) else []
    seen, out = set(), []
    for line in lines:
        head = line.split("=", 1)[0].strip()
        if head in updates:
            out.append(f"{head}={updates[head]}")
            seen.add(head)
        else:
            out.append(line)
    for k, v in updates.items():
        if k not in seen:
            out.append(f"{k}={v}")
    with open(path, "w") as f:
        f.write("\n".join(out) + "\n")
    try:
        os.chmod(path, 0o600)  # owner-only — it holds a password
    except OSError:
        pass


def ensure_credentials():
    """Prompt + persist creds on first interactive run. False = skip/non-interactive."""
    if os.environ.get("RH_USERNAME") and os.environ.get("RH_PASSWORD"):
        return True
    if not sys.stdin.isatty():
        print("No Robinhood credentials found and not running interactively — "
              "skipping the live pull; the dashboard keeps its existing data.")
        return False
    import getpass
    print("\nFirst-time setup — connect your Robinhood account.")
    print("Entered here only, saved to .env.local (git-ignored), sent only to "
          "Robinhood. Press Enter on the first prompt to skip and use existing data.\n")
    user = input("Robinhood email/username (blank to skip): ").strip()
    if not user:
        print("Skipped — using existing data.")
        return False
    pw = getpass.getpass("Robinhood password (hidden): ").strip()
    secret = input("TOTP 2FA secret (optional — blank to enter codes manually): ").strip()
    updates = {"RH_USERNAME": user, "RH_PASSWORD": pw}
    if secret:
        updates["RH_MFA_SECRET"] = secret
    persist_env(updates)
    os.environ.update(updates)
    print("Saved to .env.local.\n")
    return True


def login():
    user, pw = os.environ.get("RH_USERNAME"), os.environ.get("RH_PASSWORD")
    if not user or not pw:
        sys.exit("Set RH_USERNAME and RH_PASSWORD in .env.local.")
    mfa = None
    secret = os.environ.get("RH_MFA_SECRET")
    if secret:
        import pyotp
        mfa = pyotp.TOTP(secret).now()
    rh.login(user, pw, mfa_code=mfa, store_session=True)


def status_of(state):
    if state == FILLED:
        return "filled"
    if state in CANCELLED:
        return "cancelled"
    return "pending"


def _id_from_url(url):
    return url.rstrip("/").rsplit("/", 1)[-1] if url else None


# ── stocks ────────────────────────────────────────────────────────────────────
_sym_cache = {}


def symbol_for(url):
    if not url:
        return "?"
    if url not in _sym_cache:
        try:
            _sym_cache[url] = rh.stocks.get_symbol_by_url(url) or "?"
        except Exception:
            _sym_cache[url] = "?"
    return _sym_cache[url]


def parse_stock_orders(orders):
    """Transactions + realized events (FIFO) + fills-by-day + realized total."""
    txns, events, fills = [], [], defaultdict(int)
    lots = defaultdict(deque)  # symbol -> deque([qty, price]) of open buys
    for o in sorted(orders, key=lambda x: x.get("created_at") or ""):
        state = o.get("state")
        sym = symbol_for(o.get("instrument"))
        day = (o.get("created_at") or "")[:10]
        side = o.get("side")
        price = float(o.get("average_price") or o.get("price") or 0)
        qty = float(o.get("cumulative_quantity") or o.get("quantity") or 0)
        txns.append({
            "id": o.get("id", ""), "date": o.get("created_at") or day, "symbol": sym,
            "assetType": "stock", "side": side if side in ("buy", "sell") else "buy",
            "qty": round(qty, 4) if 0 < qty < 1 else round(qty),
            "price": round(price, 4), "status": status_of(state),
        })
        if state != FILLED or qty <= 0 or price <= 0:
            continue
        fills[day] += 1
        dq = lots[sym]
        if side == "buy":
            dq.append([qty, price])
        else:
            remaining, realized = qty, 0.0
            while remaining > 1e-9 and dq:
                lot = dq[0]
                take = min(remaining, lot[0])
                realized += take * (price - lot[1])
                lot[0] -= take
                remaining -= take
                if lot[0] <= 1e-9:
                    dq.popleft()
            if abs(realized) > 1e-9:
                events.append({"date": day, "amount": round(realized, 2),
                               "assetType": "stock", "symbol": sym})
    return txns, events, fills, round(sum(e["amount"] for e in events), 2)


# ── options ───────────────────────────────────────────────────────────────────
_instr_cache = {}


def contract_detail(leg):
    """Best-effort '$150 Call · 6/20'. '' on any miss."""
    strike, otype, exp = leg.get("strike_price"), leg.get("option_type"), leg.get("expiration_date")
    if not (strike and otype and exp):
        opt_id = leg.get("option_id") or _id_from_url(leg.get("option"))
        if opt_id:
            data = _instr_cache.get(opt_id)
            if data is None:
                try:
                    data = rh.options.get_option_instrument_data_by_id(opt_id) or {}
                except Exception:
                    data = {}
                _instr_cache[opt_id] = data
            strike = strike or data.get("strike_price")
            otype = otype or data.get("type")
            exp = exp or data.get("expiration_date")
    if not (strike and otype and exp):
        return ""
    try:
        s = f"${float(strike):g}"
    except (TypeError, ValueError):
        s = str(strike)
    label = f"{s} {str(otype).capitalize()}"
    parts = str(exp).split("-")
    if len(parts) == 3:
        label += f" · {int(parts[1])}/{int(parts[2])}"
    return label


def parse_option_orders(orders):
    """Transactions + realized events (net cashflow on closed contracts)."""
    txns, events, fills = [], [], defaultdict(int)
    cash, openq = defaultdict(float), defaultdict(float)
    for o in sorted(orders, key=lambda x: x.get("created_at") or ""):
        state = o.get("state")
        chain = o.get("chain_symbol") or o.get("symbol") or "?"
        day = (o.get("created_at") or "")[:10]
        price = float(o.get("price") or o.get("average_price") or 0)
        qty = float(o.get("processed_quantity") or o.get("quantity") or 0)
        for leg in (o.get("legs") or []):
            side = leg.get("side")
            effect = leg.get("position_effect")
            opt_id = leg.get("option_id") or _id_from_url(leg.get("option")) or chain
            txns.append({
                "id": o.get("id", "") + ":" + str(opt_id)[-6:], "date": o.get("created_at") or day,
                "symbol": chain, "assetType": "option", "detail": contract_detail(leg),
                "side": side if side in ("buy", "sell") else "buy",
                "qty": round(qty), "price": round(price, 4), "status": status_of(state),
            })
            if state != FILLED:
                continue
            fills[day] += 1
            cash[opt_id] += price * qty * 100 * (1 if side == "sell" else -1)
            openq[opt_id] += qty if effect == "open" else -qty
            if abs(openq[opt_id]) < 1e-9 and abs(cash[opt_id]) > 1e-9:
                events.append({"date": day, "amount": round(cash[opt_id], 2),
                               "assetType": "option", "symbol": chain})
                cash[opt_id] = 0.0
    return txns, events, fills, round(sum(e["amount"] for e in events), 2)


def build_account(acct, s_txns, s_events, s_fills, o_txns, o_events, o_fills):
    """Replace the account's activity fields from full stock+option history."""
    p = acct["portfolio"]
    total_value = float(p.get("equity", 0.0))

    transactions = sorted(s_txns + o_txns, key=lambda t: t.get("date", ""), reverse=True)
    events = sorted(s_events + o_events, key=lambda e: e["date"])
    realized = round(sum(e["amount"] for e in events), 2)

    acct["transactions"] = transactions
    acct["realizedEvents"] = events
    acct["orders"] = [{
        "id": t["id"], "symbol": t["symbol"], "side": t["side"], "qty": t["qty"],
        "price": t["price"], "status": t["status"], "createdAt": t["date"],
        "assetType": t["assetType"], "detail": t.get("detail"),
    } for t in transactions[:40]]

    # cumulative realized curve over all history (the "ALL" range view)
    byday = defaultdict(float)
    for e in events:
        byday[e["date"]] += e["amount"]
    base, cum, peak, series = total_value - realized, 0.0, float("-inf"), []
    for d in sorted(byday):
        cum += byday[d]
        eq = round(base + cum, 2)
        peak = max(peak, eq)
        dd = round((eq - peak) / peak * 100, 2) if peak > 0 else 0.0
        series.append({"date": d, "equity": eq, "pnl": round(cum, 2), "drawdownPct": dd})
    acct["pnlSeries"] = series

    fills = defaultdict(int)
    for d, c in list(s_fills.items()) + list(o_fills.items()):
        fills[d] += c
    acct["dailyTrades"] = [{"date": d, "count": fills[d]} for d in sorted(fills)]

    p["totalPnl"] = realized
    basis = total_value - realized
    p["totalPnlPct"] = round(realized / basis * 100, 2) if basis else 0.0
    return realized, len(transactions), round(sum(e["amount"] for e in s_events), 2), \
        round(sum(e["amount"] for e in o_events), 2)


def main():
    load_dotenv()
    if not os.path.exists(SNAP):
        sys.exit(f"{SNAP} not found. Generate the base snapshot first.")
    with open(SNAP) as f:
        snapshot = json.load(f)

    if not ensure_credentials():
        print("Dashboard will use existing data. Run `npm run snapshot` anytime to connect.")
        return

    print("Logging into Robinhood…")
    try:
        login()
    except Exception as e:  # non-interactive MFA, expired session, etc.
        sys.exit(f"Login failed: {e}. For an unattended refresh, set RH_MFA_SECRET "
                 "(TOTP) in .env.local, or run `npm run snapshot` in a terminal once "
                 "to cache a session.")

    accounts = snapshot.get("accounts") or []
    # Build every account by default. Orders are fetched PER ACCOUNT — the classic
    # API defaults to the primary account only, so without an explicit
    # account_number the non-primary accounts (Joint, Equities, …) come back empty.
    # RH_PRIMARY_ACCOUNT, if set, restricts the refresh to that single account.
    targets = [a for a in accounts if a["id"] == PRIMARY] if PRIMARY else accounts
    if PRIMARY and not targets:
        sys.exit("RH_PRIMARY_ACCOUNT not found in snapshot. Choose one of: "
                 + ", ".join(a["id"] for a in accounts))

    raw = {}
    summary = []
    for acct in targets:
        acct_id = acct["id"]
        print(f"Fetching order history for {acct['name']} ({acct_id})…")
        s_orders = rh.orders.get_all_stock_orders(account_number=acct_id) or []
        o_orders = rh.orders.get_all_option_orders(account_number=acct_id) or []
        raw[acct_id] = {"stock": s_orders, "option": o_orders}
        print(f"  {len(s_orders)} stock + {len(o_orders)} option orders")

        s_txns, s_events, s_fills, _ = parse_stock_orders(s_orders)
        o_txns, o_events, o_fills, _ = parse_option_orders(o_orders)
        realized, n, s_total, o_total = build_account(
            acct, s_txns, s_events, s_fills, o_txns, o_events, o_fills)
        summary.append((acct["name"], n, realized, s_total, o_total))

    with open(RAW, "w") as f:
        json.dump(raw, f, indent=2)

    snapshot["generatedAt"] = dt.datetime.now(dt.timezone.utc).isoformat()
    with open(SNAP, "w") as f:
        json.dump(snapshot, f, indent=2)

    print()
    for name, n, realized, s_total, o_total in summary:
        print(f"{name}: {n} transactions | realized P&L ${realized:,.2f} "
              f"(stocks ${s_total:,.2f} + options ${o_total:,.2f})")
    print(f"Updated {os.path.relpath(SNAP, ROOT)} — refresh the dashboard.")
    print(f"If a number looks off, paste me one entry from {os.path.relpath(RAW, ROOT)} "
          "(it's now keyed by account id).")


if __name__ == "__main__":
    main()
