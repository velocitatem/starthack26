import { type TelemetryPoint } from '@/types/facility';

interface SparklineProps {
  data: TelemetryPoint[];
  color?: string;
  width?: number;
  height?: number;
}

export default function Sparkline({ data, color = 'hsl(var(--brand))', width = 120, height = 32 }: SparklineProps) {
  if (!data.length) return null;

  const values = data.map(d => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline fill="none" stroke={color} strokeWidth={1.5} points={points} strokeLinejoin="round" strokeLinecap="round" />
      {/* Last point dot */}
      {values.length > 0 && (() => {
        const lastX = width;
        const lastY = height - ((values[values.length - 1] - min) / range) * (height - 4) - 2;
        return <circle cx={lastX} cy={lastY} r={2} fill={color} />;
      })()}
    </svg>
  );
}
