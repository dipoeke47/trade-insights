// Trading calendar — a month-grid heatmap of realized P&L + trade count per day.
// Server-rendered (no client JS): each active day is tinted green/red by P&L sign,
// with intensity scaled to the period's largest day, and a native hover tooltip
// carrying the exact figures.

import { signed } from "@/lib/format";

export interface DayStat {
  pnl: number;
  trades: number;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const pad = (n: number) => String(n).padStart(2, "0");

/** Tint alpha scales with the day's magnitude relative to the period's peak. */
function tint(pnl: number, maxAbs: number): string {
  const f = maxAbs ? Math.min(1, Math.abs(pnl) / maxAbs) : 0;
  const a = 0.18 + f * 0.5;
  return pnl >= 0 ? `rgba(52,211,153,${a})` : `rgba(251,113,133,${a})`;
}

/** Compact $ for tight cells: $1.2k, $940, -$3.1k. */
function compactUsd(n: number): string {
  const sign = n < 0 ? "-" : "+";
  const a = Math.abs(n);
  if (a >= 1000) return `${sign}$${(a / 1000).toFixed(a >= 10000 ? 0 : 1)}k`;
  return `${sign}$${Math.round(a)}`;
}

export function Calendar({ days }: { days: Record<string, DayStat> }) {
  const keys = Object.keys(days).sort();
  if (!keys.length) {
    return (
      <div className="flex h-24 items-center justify-center text-sm text-zinc-500">
        No activity in this range.
      </div>
    );
  }

  const maxAbs = keys.reduce((m, k) => Math.max(m, Math.abs(days[k].pnl)), 0);

  // Enumerate every month from the first active day to the last.
  const [fy, fm] = keys[0].split("-").map(Number);
  const [ly, lm] = keys[keys.length - 1].split("-").map(Number);
  const months: [number, number][] = [];
  for (let y = fy, m = fm; y < ly || (y === ly && m <= lm); m++) {
    if (m > 12) { m = 1; y++; }
    months.push([y, m]);
    if (y === ly && m === lm) break;
  }

  // Keep the page light on very wide ranges — show the most recent year and
  // point the user at the range filter for earlier months.
  const MAX_MONTHS = 12;
  const truncated = months.length > MAX_MONTHS;
  const shown = truncated ? months.slice(-MAX_MONTHS) : months;

  return (
    <>
      {truncated && (
        <p className="mb-3 text-xs text-zinc-500">
          Showing the most recent {MAX_MONTHS} months ({months.length} in range) —
          narrow the date range above to see earlier periods.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map(([y, m]) => (
          <Month key={`${y}-${m}`} year={y} month={m} days={days} maxAbs={maxAbs} />
        ))}
      </div>
    </>
  );
}

function Month({
  year,
  month,
  days,
  maxAbs,
}: {
  year: number;
  month: number;
  days: Record<string, DayStat>;
  maxAbs: number;
}) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = new Date(year, month - 1, 1).getDay();

  let monthPnl = 0;
  let monthTrades = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const e = days[`${year}-${pad(month)}-${pad(d)}`];
    if (e) {
      monthPnl += e.pnl;
      monthTrades += e.trades;
    }
  }

  const cells: React.ReactNode[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(<div key={`b${i}`} />);
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${pad(month)}-${pad(d)}`;
    const e = days[key];
    const active = !!e && (e.pnl !== 0 || e.trades > 0);
    const title = active
      ? `${MONTHS[month - 1]} ${d}, ${year} · ${signed(e!.pnl)} · ${e!.trades} ${e!.trades === 1 ? "trade" : "trades"}`
      : `${MONTHS[month - 1]} ${d}, ${year} · no activity`;
    cells.push(
      <div
        key={key}
        title={title}
        className="flex aspect-square flex-col rounded-sm border border-zinc-800/60 p-1 text-[9px] leading-tight"
        style={active && e!.pnl !== 0 ? { backgroundColor: tint(e!.pnl, maxAbs) } : undefined}
      >
        <span className="text-zinc-500">{d}</span>
        {active && (
          <span className="mt-auto">
            <span className="block font-medium tabular-nums text-zinc-100">{compactUsd(e!.pnl)}</span>
            {e!.trades > 0 && <span className="block text-zinc-400">{e!.trades}t</span>}
          </span>
        )}
      </div>,
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-semibold text-zinc-200">{MONTHS[month - 1]} {year}</span>
        <span className={`text-xs tabular-nums ${monthPnl > 0 ? "text-pos" : monthPnl < 0 ? "text-neg" : "text-zinc-500"}`}>
          {signed(monthPnl)} · {monthTrades}t
        </span>
      </div>
      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[9px] text-zinc-600">
        {WEEKDAYS.map((w, i) => <span key={i}>{w}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-1">{cells}</div>
    </div>
  );
}
