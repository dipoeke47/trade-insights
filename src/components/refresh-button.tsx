"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Triggers the local refresh route (re-runs the robin_stocks pull), then
// re-renders the server page with the new snapshot.

export function RefreshButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [msg, setMsg] = useState("");

  const run = async () => {
    setState("loading");
    setMsg("");
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setState("ok");
        setMsg("Updated");
        router.refresh();
      } else {
        setState("err");
        setMsg(data.message || "Failed");
      }
    } catch (e) {
      setState("err");
      setMsg(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <div className="flex items-center gap-2">
      {msg && (
        <span className={`max-w-[18rem] truncate text-xs ${state === "err" ? "text-neg" : "text-zinc-500"}`}>
          {msg}
        </span>
      )}
      <button
        onClick={run}
        disabled={state === "loading"}
        className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition hover:text-zinc-100 disabled:opacity-50"
      >
        {state === "loading" ? "Refreshing…" : "↻ Refresh"}
      </button>
    </div>
  );
}
