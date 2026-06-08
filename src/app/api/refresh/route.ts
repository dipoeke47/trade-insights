// Local-only refresh endpoint: re-runs the robin_stocks snapshot pull so the
// dashboard updates without a manual `npm run snapshot`. Disabled on the public
// deploy — it shells out to a credentialed local script.

import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let running = false;

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, message: "Refresh is disabled on the public deploy." },
      { status: 403 },
    );
  }
  if (running) {
    return NextResponse.json(
      { ok: false, message: "A refresh is already in progress." },
      { status: 409 },
    );
  }

  const root = process.cwd();
  const venvPy = join(root, ".venv", "bin", "python");
  const python = existsSync(venvPy) ? venvPy : "python3";

  running = true;
  try {
    const { code, out } = await new Promise<{ code: number; out: string }>((resolve) => {
      const child = spawn(python, ["scripts/build_snapshot.py"], {
        cwd: root,
        env: { ...process.env, RH_UNATTENDED: "1" },
      });
      let out = "";
      child.stdout.on("data", (d) => (out += d.toString()));
      child.stderr.on("data", (d) => (out += d.toString()));
      const timer = setTimeout(() => child.kill("SIGKILL"), 180_000);
      child.on("close", (c) => {
        clearTimeout(timer);
        resolve({ code: c ?? 1, out });
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        resolve({ code: 1, out: String(e) });
      });
    });

    const tail = out.trim().split("\n").slice(-2).join(" ").slice(0, 300);

    if (/skipping the live pull|using existing data/i.test(out)) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "No saved credentials for an unattended refresh — run `npm run snapshot` once in your terminal first.",
        },
        { status: 400 },
      );
    }
    if (code !== 0) {
      return NextResponse.json({ ok: false, message: tail || "Refresh failed." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, message: tail || "Snapshot refreshed." });
  } finally {
    running = false;
  }
}
