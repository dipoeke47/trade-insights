---
name: dashboard
description: Launch the TradeInsights dashboard with the freshest real Robinhood data available. On first run, securely collect Robinhood credentials (entered by the user in their own terminal via the snapshot script, saved to .env.local), refresh the data snapshot, then start the dev server. Never blocks on missing credentials — falls back to the existing snapshot, or demo data, automatically. Use when the user asks to run/open/launch/show the dashboard or "connect my Robinhood".
---

# TradeInsights — Launch Dashboard

Get the user looking at their dashboard with the freshest real data available,
collecting Robinhood credentials securely on first run, and **never blocking**
on missing credentials.

## Security rules (non-negotiable)

- **Never ask the user to paste their Robinhood password into the chat, and never
  write it yourself.** Passwords are entered only via `npm run snapshot` in the
  user's own terminal, where the script reads them with a hidden `getpass` prompt
  and writes them to `.env.local` (git-ignored). The password never passes through
  you or the transcript.
- Only ever check credential **presence** (`grep -q`), never print or echo values.
- `.env.local` and `*.local.json` are git-ignored — confirm before assuming they're safe.

## Steps

Run everything from the repo root.

1. **Check state** (presence only — never print values):
   - Creds present? `grep -q '^RH_USERNAME=.\+' .env.local 2>/dev/null && grep -q '^RH_PASSWORD=.\+' .env.local`
   - Snapshot present? test for `.rh-snapshot.local.json`.

2. **If credentials are present** — offer to refresh:
   - The fetch is interactive (MFA), so **don't run it yourself**. Tell the user:
     "Run `! npm run snapshot` to pull your latest trades (incl. options)."
   - It's fine to skip refresh and serve the existing snapshot.

3. **If credentials are absent** — ask once whether to connect (AskUserQuestion:
   "Connect Robinhood now / Use existing data"). 
   - **Connect:** tell the user to run `! npm run snapshot` in their terminal and
     enter their credentials when prompted (username, hidden password, optional TOTP
     secret) — saved to `.env.local`, git-ignored. Then continue to step 4.
   - **Use existing data:** continue to step 4 without fetching.

4. **Launch the dashboard:**
   - If a dev server is already serving port 3000, just give the user the URL
     (`http://localhost:3000`) — don't start a second one (Next refuses).
   - Otherwise start it in the background: `npm run dev`, then surface the URL it
     prints (it may pick 3001 if 3000 is taken).

5. **Report the data source** the user is seeing:
   - Fetch the page and check the badge: "Live · Robinhood" (real snapshot) vs
     "Demo data" (DemoProvider). Tell them which, and that `npm run snapshot`
     refreshes real data later.

## Fallback (the "use what you have" rule)

Provider selection (`src/lib/broker/index.ts`) already degrades gracefully:
`.rh-snapshot.local.json` present → real data; absent → demo data. So if the user
has no credentials and no snapshot, the app serves demo data on its own — that is
a valid outcome. Launch it anyway and tell them how to connect for real data.

## Notes

- Options data comes from `scripts/build_snapshot.py` (Robinhood's unofficial
  private API via robin_stocks), because the official agent MCP is equities-only
  in beta. The script dumps raw orders to `.rh-option-orders.local.json` for
  debugging the parser.
- First-time Python deps: `pip install -r scripts/requirements.txt`.
