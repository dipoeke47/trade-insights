"use client";

// Generic click-to-sort table. Columns with a `sort` accessor are sortable
// (click the header to toggle asc/desc); columns without one are static.
// Used by the backtest leaderboard + survivors tables.

import { useMemo, useState } from "react";

export type Col<T> = {
  key: string;
  label: string;
  align?: "left" | "right";
  sort?: (r: T) => number | string;
  cell: (r: T) => React.ReactNode;
};

export function SortableTable<T>({
  columns,
  rows,
  rowKey,
  initialKey,
  initialDir = "desc",
}: {
  columns: Col<T>[];
  rows: T[];
  rowKey: (r: T, i: number) => string;
  initialKey?: string;
  initialDir?: "asc" | "desc";
}) {
  const [key, setKey] = useState(initialKey ?? "");
  const [dir, setDir] = useState<"asc" | "desc">(initialDir);

  const active = columns.find((c) => c.key === key);
  const sorted = useMemo(() => {
    if (!active?.sort) return rows;
    const acc = active.sort;
    const out = [...rows].sort((a, b) => {
      const va = acc(a);
      const vb = acc(b);
      if (typeof va === "number" && typeof vb === "number") return va - vb;
      return String(va).localeCompare(String(vb));
    });
    return dir === "desc" ? out.reverse() : out;
  }, [rows, active, dir]);

  const onSort = (c: Col<T>) => {
    if (!c.sort) return;
    if (c.key === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setKey(c.key);
      setDir("desc");
    }
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800">
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wide text-zinc-500">
          <tr>
            {columns.map((c) => {
              const isActive = c.key === key;
              const arrow = isActive ? (dir === "asc" ? "▲" : "▼") : c.sort ? "⇅" : "";
              return (
                <th
                  key={c.key}
                  onClick={() => onSort(c)}
                  aria-sort={isActive ? (dir === "asc" ? "ascending" : "descending") : undefined}
                  className={`px-3 py-2 ${c.align === "right" ? "text-right" : "text-left"} ${
                    c.sort ? "cursor-pointer select-none hover:text-zinc-300" : ""
                  } ${isActive ? "text-zinc-200" : ""}`}
                >
                  {c.label}
                  {arrow && <span className="ml-1 opacity-60">{arrow}</span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={rowKey(r, i)} className="border-t border-zinc-800/70 hover:bg-zinc-900/40">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-3 py-2 ${c.align === "right" ? "text-right tabular-nums" : ""}`}
                >
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
