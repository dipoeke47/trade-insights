// Live backtest endpoint: spawns the local Python engine (scripts/backtest)
// with a JSON config on stdin and returns its JSON summary. Local-only — the
// public Vercel deploy has no Python/yfinance, so it 403s there and the UI
// falls back to the precomputed leaderboard.

import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set([
  "symbol", "strategy", "account_size", "entry_minute", "time_exit_minute",
  "target_pct", "stop_pct", "iv_multiplier", "signal", "interval", "dte",
]);

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Live backtests run locally only (the deploy has no Python). " +
               "Showing the precomputed leaderboard instead." },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const config: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (ALLOWED.has(k) && v !== undefined && v !== null) config[k] = v;
  }
  if (!config.symbol || !config.strategy) {
    return NextResponse.json({ error: "symbol and strategy are required." }, { status: 400 });
  }

  const root = process.cwd();
  const venvPy = join(root, ".venv", "bin", "python");
  const python = existsSync(venvPy) ? venvPy : "python3";

  const { code, out, err } = await new Promise<{ code: number; out: string; err: string }>((resolve) => {
    const child = spawn(python, ["-m", "scripts.backtest.run"], { cwd: root });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
    child.on("close", (c) => { clearTimeout(timer); resolve({ code: c ?? 1, out, err }); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: 1, out: "", err: String(e) }); });
    child.stdin.write(JSON.stringify(config));
    child.stdin.end();
  });

  if (code !== 0) {
    const tail = (err || out).trim().split("\n").slice(-3).join(" ").slice(0, 400);
    return NextResponse.json({ error: tail || "Backtest failed." }, { status: 500 });
  }

  try {
    return NextResponse.json(JSON.parse(out.trim().split("\n").pop() || "{}"));
  } catch {
    return NextResponse.json({ error: "Could not parse engine output." }, { status: 500 });
  }
}
