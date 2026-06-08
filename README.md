# TradeInsights 📈

A trading & investing dashboard — realized P&L, drawdown, daily activity, holdings, and per-symbol winners/losers — with a **global date-range filter** that re-scopes the whole page, and an **agentic AI copilot** view. Pluggable broker layer; ships with realistic demo data.

> **Demo-by-default (BYOC).** Out of the box it shows realistic demo data, so a public deploy works for everyone. Add *your own* credentials locally and it lights up with your real portfolio — **no secrets or personal data ever live in this repo** (everything personal is git-ignored).

## ✨ Features
- **Date-range control** — `1D / 1W / 1M / YTD / 1Y / ALL` + custom dates; every panel re-scopes to the selection
- **Realized P&L** — period P&L, cumulative curve, and drawdown for the selected range
- **Per-symbol winners & losers** within the range
- **Stocks + options** transactions, with options realized P&L
- **Holdings** (current) and an **AI Copilot** view *(planned)*
- **Responsive, interactive charts** — X/Y axes + hover tooltips, dependency-free SVG
- **Account switcher** for multi-account brokerages

## 🧱 Stack
| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router) · TypeScript |
| Styling | Tailwind CSS v4 |
| Charts | Dependency-free responsive SVG (axes + hover) |
| Data | `BrokerProvider` abstraction — `DemoProvider` + `RobinhoodProvider` |
| Deploy | Vercel |

## 🏗 Architecture: BYOC, demo-by-default
The entire UI renders against one interface — [`BrokerProvider`](src/lib/broker/types.ts) — so it never knows whether it's showing demo or real data:

```
no data file ─────────► DemoProvider        (everyone, incl. the public deploy)
.rh-snapshot.local.json ► RobinhoodProvider  (your real data, git-ignored)
```

Provider selection lives in [`src/lib/broker/index.ts`](src/lib/broker/index.ts). All date-range windowing is a pure function in [`src/lib/window.ts`](src/lib/window.ts), computed server-side from the selected range in the URL.

## 🚀 Getting started (demo mode)
```bash
npm install
npm run dev          # http://localhost:3000  (demo data)
```

## 🔌 Connect your own data
Personal data lives only in git-ignored files (`.env.local`, `*.local.json`, `.venv`).

**Robinhood (included adapter):**
```bash
cp .env.example .env.local        # add your RH_* credentials (git-ignored)
pip install -r scripts/requirements.txt
npm run snapshot                  # prompts for credentials on first run; writes .rh-snapshot.local.json
npm run dev
```
`scripts/build_snapshot.py` pulls your full stock + option history. Equities use Robinhood's official [Agentic Trading MCP](https://robinhood.com/us/en/support/agentic-trading); options use the classic private API via [`robin_stocks`](https://github.com/jmfernandes/robin_stocks) (unofficial — use on your own account only).

**A different broker:** implement [`BrokerProvider`](src/lib/broker/types.ts) (`listAccounts()` + `getDashboard()` returning `DashboardData`) and register it in [`index.ts`](src/lib/broker/index.ts). The UI, charts, and date-range filtering work unchanged.

## 🤖 Claude Code skill
[`.claude/skills/dashboard`](.claude/skills/dashboard/SKILL.md) — ask Claude Code to "open the dashboard": it checks for credentials (presence only), routes secure credential entry to your terminal, launches the dev server, and falls back to demo data when nothing is connected.

## 📁 Structure
```
src/
├── app/page.tsx              # dashboard (server component; reads ?range / ?account)
├── components/
│   ├── charts.tsx            # responsive SVG area/bar charts (axes + hover)
│   └── range-selector.tsx    # global date-range control (client)
└── lib/
    ├── broker/               # BrokerProvider, Demo + Robinhood providers, selection
    ├── window.ts             # date-range windowing + per-symbol P&L (pure)
    ├── app.ts · format.ts    # naming + currency/% formatting
scripts/build_snapshot.py     # local: pull real Robinhood history → snapshot (git-ignored output)
```

## 🗺 Roadmap
- [x] Dashboard UI with `DemoProvider`, deployable to Vercel
- [x] `RobinhoodProvider` (snapshot) — stocks + options, full history
- [x] Global date-range filtering + per-symbol P&L
- [ ] Live OAuth transport (auto-refresh instead of snapshot)
- [ ] Agentic copilot (natural-language order review / rebalance)

---
🤖 Built with [Claude Code](https://claude.com/claude-code)
