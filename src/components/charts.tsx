// Dependency-free SVG charts (server-renderable, no client JS).
// Phase 2 swaps these for TradingView Lightweight Charts + Tremor once real
// streaming data is wired; the props stay deliberately simple until then.

type AreaProps = {
  values: number[];
  height?: number;
  stroke?: string;
  fill?: string;
  baselineZero?: boolean;
};

export function AreaChart({
  values,
  height = 160,
  stroke = "#34d399",
  fill = "rgba(52,211,153,0.12)",
  baselineZero = false,
}: AreaProps) {
  const width = 600;
  if (values.length < 2) return null;
  const min = baselineZero ? Math.min(0, ...values) : Math.min(...values);
  const max = baselineZero ? Math.max(0, ...values) : Math.max(...values);
  const range = max - min || 1;
  const n = values.length;
  const x = (i: number) => (i / (n - 1)) * width;
  const y = (v: number) => height - ((v - min) / range) * height;
  const line = values
    .map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      style={{ height }}
      preserveAspectRatio="none"
      role="img"
    >
      <path d={area} fill={fill} />
      <path d={line} fill="none" stroke={stroke} strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

type BarProps = { values: number[]; height?: number; color?: string };

export function BarChart({ values, height = 120, color = "#60a5fa" }: BarProps) {
  const width = 600;
  if (values.length === 0) return null;
  const max = Math.max(1, ...values);
  const gap = 2;
  const bw = (width - gap * (values.length - 1)) / values.length;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }} role="img">
      {values.map((v, i) => {
        const h = (v / max) * (height - 4);
        return (
          <rect
            key={i}
            x={i * (bw + gap)}
            y={height - h}
            width={bw}
            height={h}
            rx={1.5}
            fill={color}
            opacity={0.85}
          />
        );
      })}
    </svg>
  );
}
