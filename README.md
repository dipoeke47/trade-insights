# TradeInsights 📈

A trading & investing dashboard — PNL, drawdown, positions, and daily activity at a glance — with an **agentic AI copilot** built in. Connects to a brokerage (Robinhood Agentic Trading) so an AI agent can review orders and act on your behalf.

> **Demo-by-default (BYOC).** Out of the box it shows realistic demo data, so the public deploy works for everyone. Add *your own* credentials locally and it lights up with your real portfolio — no secrets ever live in this repo.

## ✨ Features
- **Portfolio overview** — equity, day P/L, total P/L, buying power
- **Equity curve** + **drawdown** charts
- **Daily trades** activity
- **Positions** and **recent orders** tables
- **AI Copilot** view (agentic) — natural-language portfolio actions *(Phase 3)*

## 🧱 Stack
| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router) · TypeScript |
| Styling | Tailwind CSS v4 |
| Charts | Dependency-free SVG today → TradingView Lightweight Charts + Tremor *(Phase 2)* |
| Data | `BrokerProvider` abstraction — `DemoProvider` now, `RobinhoodProvider` next |
| Agentic | Anthropic API + Robinhood official agent MCP *(Phase 3)* |
| Deploy | Vercel |

## 🏗 Architecture: BYOC, demo-by-default
The entire UI renders against one interface — [`BrokerProvider`](src/lib/broker/types.ts) — so it never knows whether it's showing demo or real data:

```
no credentials ──► DemoProvider      (everyone, incl. the public deploy)
your OAuth token ─► RobinhoodProvider (you locally; anyone who connects their own)
```

Provider selection lives in [`src/lib/broker/index.ts`](src/lib/broker/index.ts). Real data comes from Robinhood's **official agent MCP** (`https://agent.robinhood.com/mcp/trading`) via OAuth — see [Agentic Trading](https://robinhood.com/us/en/support/agentic-trading).

## 🚀 Getting started
```bash
npm install
npm run dev          # http://localhost:3000  (demo mode)
```
To use real data later, copy `.env.example` → `.env.local` and add your credentials.

## 🗺 Roadmap
- [x] **Phase 1** — dashboard UI with `DemoProvider`, deployable to Vercel
- [ ] **Phase 2** — `RobinhoodProvider` + OAuth "Connect" flow; swap in TradingView charts
- [ ] **Phase 3** — agentic copilot (natural-language order review / rebalance)
- [ ] Live quotes (WebSocket) + Redis caching

## 📁 Structure
```
src/
├── app/                  # Next.js routes (dashboard at /)
├── components/charts.tsx # SVG area/bar charts
└── lib/
    ├── broker/           # BrokerProvider, DemoProvider, provider selection
    ├── app.ts            # product name/tagline
    └── format.ts         # currency / % formatting
```

---
🤖 Built with [Claude Code](https://claude.com/claude-code)
