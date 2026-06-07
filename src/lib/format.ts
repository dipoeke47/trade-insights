export const usd = (n: number, frac = 0) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: frac,
    maximumFractionDigits: frac,
  });

export const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

export const signed = (n: number) => `${n >= 0 ? "+" : "-"}${usd(Math.abs(n))}`;

export const toneClass = (n: number) =>
  n > 0 ? "text-emerald-400" : n < 0 ? "text-rose-400" : "text-zinc-400";
