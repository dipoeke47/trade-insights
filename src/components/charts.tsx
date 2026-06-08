"use client";

// Responsive, interactive SVG charts — dependency-free.
// - Width tracks the container (ResizeObserver), so they reflow with the layout.
// - X/Y axes with tick labels + light gridlines.
// - Hover anywhere to get a crosshair + tooltip with the date and value.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { usd } from "@/lib/format";

const useIso = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** Track the rendered width of a container element. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  useIso(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect.width ?? 0;
      if (cw > 0) setW(cw);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

type ValueFormat = "usd" | "pct" | "int";

function fmt(v: number, kind: ValueFormat): string {
  if (kind === "usd") return usd(v);
  if (kind === "pct") return `${v.toFixed(1)}%`;
  return String(Math.round(v));
}

function shortDate(s?: string): string {
  if (!s) return "";
  const parts = s.split("-");
  return parts.length === 3 ? `${+parts[1]}/${+parts[2]}` : s;
}

function ticks(min: number, max: number, count = 4): number[] {
  if (max === min) return [min];
  const step = (max - min) / count;
  return Array.from({ length: count + 1 }, (_, i) => min + step * i);
}

const MARGIN = { top: 10, right: 14, bottom: 22, left: 54 };
const AXIS = "#71717a"; // zinc-500
const GRID = "#27272a"; // zinc-800

type AreaProps = {
  values: number[];
  labels: string[];
  format?: ValueFormat;
  height?: number;
  stroke?: string;
  fill?: string;
  baselineZero?: boolean;
};

export function AreaChart({
  values,
  labels,
  format = "usd",
  height = 180,
  stroke = "#34d399",
  fill = "rgba(52,211,153,0.12)",
  baselineZero = false,
}: AreaProps) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);

  const iw = Math.max(1, width - MARGIN.left - MARGIN.right);
  const ih = height - MARGIN.top - MARGIN.bottom;
  const n = values.length;

  if (n < 2) return <div ref={ref} style={{ height }} />;

  const min = baselineZero ? Math.min(0, ...values) : Math.min(...values);
  const max = baselineZero ? Math.max(0, ...values) : Math.max(...values);
  const range = max - min || 1;
  const x = (i: number) => MARGIN.left + (i / (n - 1)) * iw;
  const y = (v: number) => MARGIN.top + ih - ((v - min) / range) * ih;

  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)},${MARGIN.top + ih} L${x(0).toFixed(1)},${MARGIN.top + ih} Z`;

  const yt = ticks(min, max);
  const xIdx = [0, Math.round((n - 1) / 3), Math.round((2 * (n - 1)) / 3), n - 1];

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round(((px - MARGIN.left) / iw) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <div ref={ref} className="relative" style={{ height }}>
      <svg width={width} height={height} role="img" className="block">
        {/* gridlines + y labels */}
        {yt.map((v, i) => (
          <g key={i}>
            <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth={1} />
            <text x={MARGIN.left - 8} y={y(v) + 3} textAnchor="end" fontSize={10} fill={AXIS}>
              {fmt(v, format)}
            </text>
          </g>
        ))}
        {/* x labels */}
        {xIdx.map((i) => (
          <text key={i} x={x(i)} y={height - 6} textAnchor="middle" fontSize={10} fill={AXIS}>
            {shortDate(labels[i])}
          </text>
        ))}
        {/* axes */}
        <line x1={MARGIN.left} x2={MARGIN.left} y1={MARGIN.top} y2={MARGIN.top + ih} stroke={AXIS} strokeWidth={1} />
        <line x1={MARGIN.left} x2={width - MARGIN.right} y1={MARGIN.top + ih} y2={MARGIN.top + ih} stroke={AXIS} strokeWidth={1} />
        {/* series */}
        <path d={area} fill={fill} />
        <path d={line} fill="none" stroke={stroke} strokeWidth={2} />
        {/* hover crosshair */}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={MARGIN.top} y2={MARGIN.top + ih} stroke={AXIS} strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(values[hover])} r={3.5} fill={stroke} stroke="#0a0a0a" strokeWidth={1.5} />
          </g>
        )}
        {/* hover capture */}
        <rect
          x={MARGIN.left}
          y={MARGIN.top}
          width={iw}
          height={ih}
          fill="transparent"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        />
      </svg>
      {hover !== null && (
        <Tooltip x={x(hover)} width={width} label={shortDate(labels[hover])} value={fmt(values[hover], format)} />
      )}
    </div>
  );
}

type BarProps = {
  values: number[];
  labels: string[];
  height?: number;
  color?: string;
  unit?: string;
};

export function BarChart({ values, labels, height = 150, color = "#60a5fa", unit = "trades" }: BarProps) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);

  const iw = Math.max(1, width - MARGIN.left - MARGIN.right);
  const ih = height - MARGIN.top - MARGIN.bottom;
  const n = values.length;

  if (n === 0) return <div ref={ref} style={{ height }} />;

  const max = Math.max(1, ...values);
  const yt = ticks(0, max);
  const slot = iw / n;
  const bw = Math.max(1, slot * 0.7);
  const x = (i: number) => MARGIN.left + i * slot + (slot - bw) / 2;
  const y = (v: number) => MARGIN.top + ih - (v / max) * ih;
  const xIdx = [0, Math.round((n - 1) / 2), n - 1];

  return (
    <div ref={ref} className="relative" style={{ height }}>
      <svg width={width} height={height} role="img" className="block">
        {yt.map((v, i) => (
          <g key={i}>
            <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth={1} />
            <text x={MARGIN.left - 8} y={y(v) + 3} textAnchor="end" fontSize={10} fill={AXIS}>
              {Math.round(v)}
            </text>
          </g>
        ))}
        {xIdx.map((i) => (
          <text key={i} x={MARGIN.left + i * slot + slot / 2} y={height - 6} textAnchor="middle" fontSize={10} fill={AXIS}>
            {shortDate(labels[i])}
          </text>
        ))}
        <line x1={MARGIN.left} x2={MARGIN.left} y1={MARGIN.top} y2={MARGIN.top + ih} stroke={AXIS} strokeWidth={1} />
        <line x1={MARGIN.left} x2={width - MARGIN.right} y1={MARGIN.top + ih} y2={MARGIN.top + ih} stroke={AXIS} strokeWidth={1} />
        {values.map((v, i) => (
          <rect
            key={i}
            x={x(i)}
            y={y(v)}
            width={bw}
            height={MARGIN.top + ih - y(v)}
            rx={1.5}
            fill={color}
            opacity={hover === null || hover === i ? 0.9 : 0.4}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>
      {hover !== null && (
        <Tooltip x={MARGIN.left + hover * slot + slot / 2} width={width} label={shortDate(labels[hover])} value={`${values[hover]} ${unit}`} />
      )}
    </div>
  );
}

function Tooltip({ x, width, label, value }: { x: number; width: number; label: string; value: string }) {
  // Keep the tooltip inside the chart bounds.
  const left = Math.max(40, Math.min(width - 40, x));
  return (
    <div
      className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-900/95 px-2 py-1 text-xs shadow-lg"
      style={{ left }}
    >
      <span className="text-zinc-500">{label}</span>
      <span className="ml-2 font-medium text-zinc-100">{value}</span>
    </div>
  );
}
