"""Run ONE backtest config and print a JSON summary to stdout.

Used by the Next.js API route (`/api/backtest`) for interactive runs, and
usable directly:

    .venv/bin/python -m scripts.backtest.run '{"symbol":"SPY","strategy":"long_call_put"}'
    echo '{...}' | .venv/bin/python -m scripts.backtest.run
"""
from __future__ import annotations

import json
import sys

from .data import load_sessions
from .engine import RunConfig, run_backtest
from .metrics import summarize

_VALID = set(RunConfig().__dict__.keys())


def main(argv: list[str]) -> int:
    raw = argv[1] if len(argv) > 1 else sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"bad JSON config: {e}"}))
        return 1

    cfg_kwargs = {k: v for k, v in payload.items() if k in _VALID}
    cfg = RunConfig(**cfg_kwargs)
    try:
        sessions = load_sessions(cfg.symbol, cfg.interval, cfg.period)
        result = run_backtest(sessions, cfg)
        summary = summarize(result)
        summary["days"] = [d.__dict__ for d in result.days]
        print(json.dumps(summary))
        return 0
    except Exception as e:
        print(json.dumps({"error": f"{type(e).__name__}: {e}"}))
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
