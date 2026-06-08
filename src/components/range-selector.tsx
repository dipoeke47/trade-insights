"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { RANGE_PRESETS, type RangePreset } from "@/lib/window";

// Global date-range control. Writes the range to the URL (?range= or ?from/&to)
// and preserves the active account, so the whole server-rendered page re-scopes.

export function RangeSelector({ active }: { active: RangePreset | "CUSTOM" }) {
  const router = useRouter();
  const params = useSearchParams();

  const push = (mut: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(params.toString());
    mut(p);
    router.push(`/?${p.toString()}`);
  };

  const setPreset = (preset: RangePreset) =>
    push((p) => {
      p.set("range", preset);
      p.delete("from");
      p.delete("to");
    });

  const setCustom = (key: "from" | "to", val: string) =>
    push((p) => {
      p.delete("range");
      if (val) p.set(key, val);
      else p.delete(key);
    });

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {RANGE_PRESETS.map((r) => (
        <button
          key={r}
          onClick={() => setPreset(r)}
          className={`rounded-md border px-2.5 py-1 text-xs transition ${
            active === r
              ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-200"
              : "border-zinc-700 text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {r}
        </button>
      ))}
      <span className="mx-1 text-zinc-700">|</span>
      <input
        type="date"
        defaultValue={params.get("from") ?? ""}
        onChange={(e) => setCustom("from", e.target.value)}
        aria-label="From date"
        className={`rounded-md border bg-zinc-900 px-2 py-1 text-xs text-zinc-300 ${
          active === "CUSTOM" ? "border-emerald-500/50" : "border-zinc-700"
        }`}
      />
      <span className="text-xs text-zinc-600">→</span>
      <input
        type="date"
        defaultValue={params.get("to") ?? ""}
        onChange={(e) => setCustom("to", e.target.value)}
        aria-label="To date"
        className={`rounded-md border bg-zinc-900 px-2 py-1 text-xs text-zinc-300 ${
          active === "CUSTOM" ? "border-emerald-500/50" : "border-zinc-700"
        }`}
      />
    </div>
  );
}
