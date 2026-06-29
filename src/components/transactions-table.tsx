"use client";

import { useMemo, useState } from "react";
import type { Transaction } from "@/lib/broker/types";
import { usd } from "@/lib/format";

// Client-side filtering + pagination for the (potentially long) transaction
// list. The server hands us the full in-range set already sorted newest-first;
// all narrowing happens here so it's instant and doesn't round-trip.

const PAGE_SIZE = 25;

type AssetFilter = "all" | "stock" | "option";
type SideFilter = "all" | "buy" | "sell";
type StatusFilter = "all" | "filled" | "pending" | "cancelled";

export function TransactionsTable({ transactions }: { transactions: Transaction[] }) {
  const [asset, setAsset] = useState<AssetFilter>("all");
  const [side, setSide] = useState<SideFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    return transactions.filter(
      (t) =>
        (asset === "all" || t.assetType === asset) &&
        (side === "all" || t.side === side) &&
        (status === "all" || t.status === status) &&
        (!q || t.symbol.toUpperCase().includes(q)),
    );
  }, [transactions, asset, side, status, query]);

  // Keep the page in range as filters shrink the result set.
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * PAGE_SIZE;
  const rows = filtered.slice(start, start + PAGE_SIZE);

  // Any filter change should snap back to the first page.
  const reset = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(0);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select label="Type" value={asset} onChange={reset(setAsset)}
          options={[["all", "All types"], ["stock", "Stock"], ["option", "Option"]]} />
        <Select label="Side" value={side} onChange={reset(setSide)}
          options={[["all", "Buy & sell"], ["buy", "Buy"], ["sell", "Sell"]]} />
        <Select label="Status" value={status} onChange={reset(setStatus)}
          options={[["all", "Any status"], ["filled", "Filled"], ["pending", "Pending"], ["cancelled", "Cancelled"]]} />
        <input
          value={query}
          onChange={(e) => reset(setQuery)(e.target.value)}
          placeholder="Symbol…"
          aria-label="Filter by symbol"
          className="w-28 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 placeholder:text-zinc-600"
        />
      </div>

      {filtered.length ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-zinc-500">
                  {["Date", "Symbol", "Type", "Side", "Qty", "Price", "Status"].map((h) => (
                    <th key={h} className="pb-2 pr-4 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {rows.map((o) => (
                  <tr key={o.id} className="text-zinc-200">
                    <td className="py-2 pr-4 tabular-nums">{new Date(o.date).toLocaleDateString("en-US")}</td>
                    <td className="py-2 pr-4">
                      <span className="font-medium">{o.symbol}</span>
                      {o.detail ? <span className="ml-1 text-xs text-zinc-500">{o.detail}</span> : null}
                    </td>
                    <td className={`py-2 pr-4 ${o.assetType === "option" ? "text-violet-300" : "text-zinc-400"}`}>
                      {o.assetType === "option" ? "Option" : "Stock"}
                    </td>
                    <td className={`py-2 pr-4 ${o.side === "buy" ? "text-pos" : "text-neg"}`}>
                      {o.side.toUpperCase()}
                    </td>
                    <td className="py-2 pr-4 tabular-nums">{o.qty}</td>
                    <td className="py-2 pr-4 tabular-nums">{usd(o.price, 2)}</td>
                    <td className="py-2 pr-4 text-zinc-400">{o.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
            <span>
              Showing <span className="text-zinc-300">{start + 1}</span>–
              <span className="text-zinc-300">{start + rows.length}</span> of{" "}
              <span className="text-zinc-300">{filtered.length}</span>
              {filtered.length !== transactions.length && ` (filtered from ${transactions.length})`}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(safePage - 1)}
                disabled={safePage === 0}
                className="rounded-md border border-zinc-700 px-2 py-1 transition hover:text-zinc-200 disabled:opacity-40 disabled:hover:text-zinc-500"
              >
                ← Prev
              </button>
              <span className="tabular-nums text-zinc-400">{safePage + 1} / {pageCount}</span>
              <button
                onClick={() => setPage(safePage + 1)}
                disabled={safePage >= pageCount - 1}
                className="rounded-md border border-zinc-700 px-2 py-1 transition hover:text-zinc-200 disabled:opacity-40 disabled:hover:text-zinc-500"
              >
                Next →
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="flex h-24 items-center justify-center text-sm text-zinc-500">
          {transactions.length ? "No transactions match these filters." : "No transactions in this range."}
        </div>
      )}
    </div>
  );
}

function Select<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      aria-label={label}
      className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300"
    >
      {options.map(([v, lbl]) => (
        <option key={v} value={v}>{lbl}</option>
      ))}
    </select>
  );
}
