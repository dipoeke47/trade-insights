export const usd = (n: number, frac = 0) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: frac,
    maximumFractionDigits: frac,
  });

export const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

export const signed = (n: number) => `${n >= 0 ? "+" : "-"}${usd(Math.abs(n))}`;

/** "Jun 8, 2026, 3:42 PM" — for snapshot timestamps. */
export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** "Jun 8, 2026" — date only, for coverage range. */
export const dateOnly = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// Semantic tone tokens swap shade by theme (see globals.css) so +/- P&L stays
// readable on both light and dark backgrounds.
export const toneClass = (n: number) =>
  n > 0 ? "text-pos" : n < 0 ? "text-neg" : "text-zinc-400";
