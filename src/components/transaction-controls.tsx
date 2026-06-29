"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// URL-backed controls for the (server-filtered, server-paginated) transactions
// table. All state lives in the query string — ?txType/&txSide/&txStatus/&txSym
// /&txPage — so it survives reloads, is shareable, and the server does the work.

function useUrlMutator() {
  const router = useRouter();
  const params = useSearchParams();
  return (mut: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(params.toString());
    mut(p);
    router.push(`/?${p.toString()}`, { scroll: false });
  };
}

export function TransactionFilters({
  type,
  side,
  status,
  sym,
}: {
  type: string;
  side: string;
  status: string;
  sym: string;
}) {
  const push = useUrlMutator();
  const [q, setQ] = useState(sym);

  const setParam = (key: string, val: string) =>
    push((p) => {
      if (val && val !== "all") p.set(key, val);
      else p.delete(key);
      p.delete("txPage");
    });

  // Debounce the symbol box so we don't navigate on every keystroke.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = setTimeout(() => setParam("txSym", q.trim()), 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Select label="Type" value={type} onChange={(v) => setParam("txType", v)}
        options={[["all", "All types"], ["stock", "Stock"], ["option", "Option"]]} />
      <Select label="Side" value={side} onChange={(v) => setParam("txSide", v)}
        options={[["all", "Buy & sell"], ["buy", "Buy"], ["sell", "Sell"]]} />
      <Select label="Status" value={status} onChange={(v) => setParam("txStatus", v)}
        options={[["all", "Any status"], ["filled", "Filled"], ["pending", "Pending"], ["cancelled", "Cancelled"]]} />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Symbol…"
        aria-label="Filter by symbol"
        className="w-28 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 placeholder:text-zinc-600"
      />
    </div>
  );
}

export function TransactionPager({
  page,
  pageCount,
  pageSize,
  filteredTotal,
  total,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  filteredTotal: number;
  total: number;
}) {
  const push = useUrlMutator();
  const goPage = (n: number) =>
    push((p) => {
      if (n > 0) p.set("txPage", String(n));
      else p.delete("txPage");
    });

  const start = filteredTotal === 0 ? 0 : page * pageSize + 1;
  const end = Math.min(filteredTotal, (page + 1) * pageSize);

  return (
    <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
      <span>
        Showing <span className="text-zinc-300">{start}</span>–
        <span className="text-zinc-300">{end}</span> of{" "}
        <span className="text-zinc-300">{filteredTotal}</span>
        {filteredTotal !== total && ` (filtered from ${total})`}
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => goPage(page - 1)}
          disabled={page === 0}
          className="rounded-md border border-zinc-700 px-2 py-1 transition hover:text-zinc-200 disabled:opacity-40 disabled:hover:text-zinc-500"
        >
          ← Prev
        </button>
        <span className="tabular-nums text-zinc-400">{page + 1} / {pageCount}</span>
        <button
          onClick={() => goPage(page + 1)}
          disabled={page >= pageCount - 1}
          className="rounded-md border border-zinc-700 px-2 py-1 transition hover:text-zinc-200 disabled:opacity-40 disabled:hover:text-zinc-500"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300"
    >
      {options.map(([v, lbl]) => (
        <option key={v} value={v}>{lbl}</option>
      ))}
    </select>
  );
}
