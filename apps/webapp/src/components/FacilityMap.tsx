import { useRef, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useGesture } from '@use-gesture/react';
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import { type AHUUnit, type Device, type AirflowDirection } from '@/types/facility';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface FacilityMapProps {
  ahuUnits: AHUUnit[];
  devices: Device[];
  nodePositions: Record<string, number>;
  onDeviceSelect: (device: Device) => void;
  selectedDeviceId: string | null;
}

const statusColor: Record<string, string> = {
  healthy: 'var(--status-healthy)',
  warning: 'var(--status-warning)',
  fault: 'var(--status-fault)',
  offline: 'var(--status-offline)',
};

const formatAnomalyConfidence = (value: number) => `${Math.round(value * 100)}%`;

const DeviceIconSVG = ({ color }: { color: string }) => (
  <g transform="translate(-6,-6)">
    <rect x="0.5" y="4.8" width="11" height="2.4" rx="0.5" transform="rotate(-45 6 6)" fill="none" stroke={color} strokeWidth="0.9" />
    <circle cx="6" cy="6" r="2.2" fill="none" stroke={color} strokeWidth="0.9" />
    <circle cx="6" cy="6" r="1.1" fill="none" stroke={color} strokeWidth="0.7" />
    <circle cx="6" cy="6" r="0.4" fill={color} />
  </g>
);

const DeviceNode = ({ device, selected, onClick }: { device: Device; selected: boolean; onClick: () => void }) => {
  const color = `hsl(${statusColor[device.status]})`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.g
          onClick={onClick}
          style={{ cursor: 'pointer' }}
          whileHover={{ scale: 1.15 }}
          transition={{ duration: 0.12, ease: [0.2, 0, 0, 1] }}
        >
          {device.status === 'fault' && (
            <circle cx={device.x} cy={device.y} r={18} fill="none" stroke={color} strokeWidth={1} opacity={0.4} className="animate-pulse-glow" />
          )}
          {selected && (
            <circle cx={device.x} cy={device.y} r={16} fill="none" stroke="hsl(var(--foreground))" strokeWidth={1.5} />
          )}
          <circle cx={device.x} cy={device.y} r={12} fill="hsl(var(--card))" stroke="none" />
          <circle cx={device.x} cy={device.y} r={12} fill={`hsl(${statusColor[device.status]} / 0.15)`} stroke={color} strokeWidth={1.5} />
          <g transform={`translate(${device.x},${device.y})`}>
            <DeviceIconSVG color={color} />
          </g>
        </motion.g>
      </TooltipTrigger>
      <TooltipContent side="top" className="bg-popover border-border text-popover-foreground p-0">
        <div className="px-3 py-2">
          <div className="text-[12px] font-medium">{device.name}</div>
          <div className="text-[11px] text-muted-foreground">{device.id} · {device.zone}</div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-[11px] capitalize">{device.status}</span>
            <span className="text-[11px] text-muted-foreground ml-1">Deviation: {formatAnomalyConfidence(device.anomalyScore)}</span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
};

const ductConnections = [
  { targetId: 'BEL-VNT-001', d: 'M 310 240 L 240 240 L 240 210 L 160 210' },
  { targetId: 'BEL-VNT-002', d: 'M 310 240 L 200 240 L 200 100 L 80 100' },
  { targetId: 'BEL-VNT-003', d: 'M 310 240 L 420 240 L 420 100 L 550 100' },
  { targetId: 'BEL-VNT-004', d: 'M 310 240 L 500 240 L 500 200 L 700 200' },
  { targetId: 'ahu-02', d: 'M 310 260 L 310 370 L 460 370' },
  { targetId: 'BEL-VNT-005', d: 'M 460 370 L 200 370 L 200 380 L 100 380' },
  { targetId: 'BEL-VNT-006', d: 'M 460 370 L 580 370 L 580 450 L 700 450' },
  { targetId: 'BEL-VNT-007', d: 'M 460 370 L 580 370 L 580 550 L 750 550' },
  { targetId: 'BEL-VNT-008', d: 'M 460 390 L 460 520 L 350 520' },
];

const AnimatedDuct = ({ id, d, flow }: { id: string; d: string; flow: number }) => (
  <g>
    <path id={id} d={d} stroke="hsl(var(--status-healthy) / 0.12)" strokeWidth={3} fill="none" strokeLinecap="round" />
    {flow > 0 && (
      <path
        d={d}
        stroke="hsl(var(--status-healthy) / 0.55)"
        strokeWidth={1.5}
        fill="none"
        strokeLinecap="round"
        strokeDasharray="6 14"
        className="duct-flow"
        style={{ animationDuration: `${Math.min(8, 2 / flow)}s` }}
      />
    )}
  </g>
);

const Ductwork = ({ nodePositions }: { nodePositions: Record<string, number> }) => (
  <g>
    {ductConnections.map(({ targetId, d }) => (
      <AnimatedDuct key={targetId} id={`duct-${targetId}`} d={d} flow={nodePositions[targetId] ?? 0} />
    ))}
  </g>
);

// The floor plan SVG extracted from the uploaded HTML, with all text removed
const FloorPlanBase = () => (
  <g>
    {/* Wall pattern */}
    <defs>
      <pattern id="wallHatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="6" stroke="hsl(var(--muted-foreground))" strokeWidth="0.5" opacity="0.15" />
      </pattern>
    </defs>

    {/* Outer walls */}
    <rect x="20" y="20" width="780" height="580" fill="none" stroke="hsl(var(--foreground) / 0.6)" strokeWidth="10" rx="2" />

    {/* Inner walls */}
    <rect x="300" y="20" width="8" height="200" fill="hsl(var(--foreground) / 0.5)" />
    <rect x="20" y="280" width="220" height="8" fill="hsl(var(--foreground) / 0.5)" />
    <rect x="170" y="280" width="8" height="190" fill="hsl(var(--foreground) / 0.5)" />
    <rect x="430" y="320" width="370" height="8" fill="hsl(var(--foreground) / 0.5)" />
    <rect x="580" y="320" width="8" height="280" fill="hsl(var(--foreground) / 0.5)" />
    <rect x="178" y="400" width="252" height="8" fill="hsl(var(--foreground) / 0.5)" />
    <rect x="178" y="400" width="8" height="70" fill="hsl(var(--foreground) / 0.5)" />

    {/* Doors */}
    <g>
      <line x1="20" y1="500" x2="20" y2="560" stroke="hsl(var(--muted-foreground) / 0.5)" strokeWidth="3" />
      <path d="M 20 500 Q 55 500, 55 530" fill="none" stroke="hsl(var(--muted-foreground) / 0.5)" strokeWidth="1.5" strokeDasharray="3,2" />
    </g>
    <g>
      <line x1="100" y1="280" x2="150" y2="280" stroke="hsl(var(--card))" strokeWidth="10" />
      <line x1="100" y1="280" x2="150" y2="280" stroke="hsl(var(--muted-foreground) / 0.5)" strokeWidth="1.5" />
      <path d="M 100 280 Q 100 318, 130 318" fill="none" stroke="hsl(var(--muted-foreground) / 0.5)" strokeWidth="1" strokeDasharray="3,2" />
    </g>
    <g>
      <line x1="470" y1="320" x2="530" y2="320" stroke="hsl(var(--card))" strokeWidth="10" />
      <line x1="470" y1="320" x2="530" y2="320" stroke="hsl(var(--muted-foreground) / 0.5)" strokeWidth="1.5" />
      <path d="M 470 320 Q 470 358, 500 358" fill="none" stroke="hsl(var(--muted-foreground) / 0.5)" strokeWidth="1" strokeDasharray="3,2" />
    </g>
    <g>
      <line x1="620" y1="320" x2="680" y2="320" stroke="hsl(var(--card))" strokeWidth="10" />
      <line x1="620" y1="320" x2="680" y2="320" stroke="hsl(var(--muted-foreground) / 0.5)" strokeWidth="1.5" />
      <path d="M 680 320 Q 680 358, 650 358" fill="none" stroke="hsl(var(--muted-foreground) / 0.5)" strokeWidth="1" strokeDasharray="3,2" />
    </g>
    <g>
      <line x1="300" y1="120" x2="300" y2="190" stroke="hsl(var(--card))" strokeWidth="10" />
      <line x1="300" y1="120" x2="300" y2="190" stroke="hsl(var(--muted-foreground) / 0.5)" strokeWidth="1.5" />
    </g>

    {/* Windows */}
    <g>
      <line x1="420" y1="20" x2="560" y2="20" stroke="hsl(var(--muted-foreground) / 0.4)" strokeWidth="5" />
      <line x1="420" y1="17" x2="560" y2="17" stroke="hsl(var(--muted-foreground) / 0.2)" strokeWidth="1" />
      <line x1="420" y1="23" x2="560" y2="23" stroke="hsl(var(--muted-foreground) / 0.2)" strokeWidth="1" />
    </g>
    <g>
      <line x1="640" y1="20" x2="760" y2="20" stroke="hsl(var(--muted-foreground) / 0.4)" strokeWidth="5" />
      <line x1="640" y1="17" x2="760" y2="17" stroke="hsl(var(--muted-foreground) / 0.2)" strokeWidth="1" />
      <line x1="640" y1="23" x2="760" y2="23" stroke="hsl(var(--muted-foreground) / 0.2)" strokeWidth="1" />
    </g>
    <g>
      <line x1="800" y1="400" x2="800" y2="520" stroke="hsl(var(--muted-foreground) / 0.4)" strokeWidth="5" />
      <line x1="797" y1="400" x2="797" y2="520" stroke="hsl(var(--muted-foreground) / 0.2)" strokeWidth="1" />
    </g>
    <g>
      <line x1="620" y1="600" x2="760" y2="600" stroke="hsl(var(--muted-foreground) / 0.4)" strokeWidth="5" />
      <line x1="620" y1="597" x2="760" y2="597" stroke="hsl(var(--muted-foreground) / 0.2)" strokeWidth="1" />
    </g>
    <g>
      <line x1="20" y1="320" x2="20" y2="390" stroke="hsl(var(--muted-foreground) / 0.4)" strokeWidth="5" />
      <line x1="17" y1="320" x2="17" y2="390" stroke="hsl(var(--muted-foreground) / 0.2)" strokeWidth="1" />
    </g>

    {/* Kitchen furniture */}
    <g opacity="0.3">
      {/* Stove */}
      <rect x="35" y="35" width="70" height="60" rx="3" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="1" />
      <circle cx="55" cy="52" r="8" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.8" />
      <circle cx="85" cy="52" r="8" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.8" />
      <circle cx="55" cy="78" r="8" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.8" />
      <circle cx="85" cy="78" r="8" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.8" />
      {/* Sink */}
      <rect x="35" y="110" width="70" height="50" rx="3" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="1" />
      <rect x="42" y="117" width="24" height="36" rx="8" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.8" />
      <rect x="72" y="117" width="24" height="36" rx="8" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.8" />
      {/* Counter */}
      <rect x="35" y="170" width="70" height="15" rx="2" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.8" />
      <rect x="35" y="185" width="15" height="70" rx="2" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.8" />
      {/* Fridge */}
      <rect x="120" y="35" width="50" height="65" rx="3" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="1" />
      <line x1="145" y1="38" x2="145" y2="97" stroke="hsl(var(--muted-foreground))" strokeWidth="0.6" />
      {/* Dining table */}
      <rect x="180" y="120" width="100" height="65" rx="4" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="1" />
      <rect x="192" y="108" width="22" height="10" rx="3" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.8" />
      <rect x="246" y="108" width="22" height="10" rx="3" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.8" />
      <rect x="192" y="187" width="22" height="10" rx="3" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.8" />
      <rect x="246" y="187" width="22" height="10" rx="3" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.8" />
      <rect x="168" y="135" width="10" height="22" rx="3" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.8" />
      <rect x="282" y="135" width="10" height="22" rx="3" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.8" />
    </g>

    {/* Living room furniture */}
    <g opacity="0.3">
      <rect x="380" y="230" width="180" height="60" rx="6" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="1" />
      <rect x="580" y="230" width="55" height="55" rx="6" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="1" />
      <rect x="430" y="170" width="100" height="45" rx="3" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.8" />
      <rect x="420" y="36" width="160" height="18" rx="2" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.8" />
      <circle cx="660" cy="260" r="16" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.8" />
      <circle cx="770" cy="50" r="13" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.8" />
      <rect x="660" y="30" width="80" height="20" rx="2" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.8" />
    </g>

    {/* Bathroom furniture */}
    <g opacity="0.3">
      <rect x="30" y="295" width="55" height="105" rx="20" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="1" />
      <rect x="105" y="295" width="40" height="22" rx="3" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.8" />
      <ellipse cx="125" cy="338" rx="18" ry="22" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.8" />
      <rect x="105" y="405" width="48" height="35" rx="3" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.8" />
      <ellipse cx="129" cy="422" rx="16" ry="11" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.6" />
    </g>

    {/* Bedroom 1 furniture */}
    <g opacity="0.3">
      <rect x="640" y="370" width="130" height="160" rx="4" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="1" />
      <rect x="650" y="378" width="48" height="30" rx="8" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.6" />
      <rect x="712" y="378" width="48" height="30" rx="8" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.6" />
      <rect x="640" y="540" width="35" height="30" rx="2" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.8" />
      <rect x="736" y="540" width="35" height="30" rx="2" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.8" />
      <rect x="600" y="370" width="25" height="100" rx="2" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.8" />
    </g>

    {/* Bedroom 2 furniture */}
    <g opacity="0.3">
      <rect x="210" y="440" width="80" height="140" rx="4" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="1" />
      <rect x="222" y="448" width="56" height="26" rx="8" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.6" />
      <rect x="320" y="440" width="80" height="40" rx="2" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.8" />
      <circle cx="360" cy="505" r="16" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.8" />
      <rect x="320" y="558" width="80" height="18" rx="2" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.8" />
      <rect x="435" y="420" width="24" height="80" rx="2" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.8" />
    </g>
  </g>
);

const RING_COUNT = 3;
const airflowColor: Record<NonNullable<AirflowDirection>, string> = {
  supply: '175 65% 48%',
  return: '270 50% 62%',
};

const AirflowRing = ({ cx, cy, direction, delay, duration, color }: {
  cx: number; cy: number; direction: NonNullable<AirflowDirection>; delay: number; duration: number; color: string;
}) => (
  <circle
    cx={cx} cy={cy} r={6}
    fill="none"
    stroke={`hsl(${color})`}
    strokeWidth={1}
    className={direction === 'supply' ? 'airflow-expand' : 'airflow-contract'}
    style={{ animationDuration: `${duration}s`, animationDelay: `${delay}s` }}
  />
);

const AirflowOverlay = ({ devices, nodePositions }: { devices: Device[]; nodePositions: Record<string, number> }) => (
  <g>
    {devices
      .filter(d => d.airflowDirection && (nodePositions[d.id] ?? 0) > 0)
      .map(d => {
        const flow = nodePositions[d.id] ?? 0;
        const baseDur = Math.max(1.5, 4 - flow * 2.5);
        const dur = d.airflowDirection === 'supply' ? baseDur * 1.6 : baseDur;
        const color = airflowColor[d.airflowDirection!];
        return Array.from({ length: RING_COUNT }, (_, i) => (
          <AirflowRing
            key={`${d.id}-${i}`}
            cx={d.x} cy={d.y}
            direction={d.airflowDirection!}
            delay={(dur / RING_COUNT) * i}
            duration={dur}
            color={color}
          />
        ));
      })}
  </g>
);

const AHUNodes = ({ ahuUnits }: { ahuUnits: AHUUnit[] }) => (
  <g>
    {ahuUnits.map(ahu => (
      <g key={ahu.id}>
        <rect
          x={ahu.x - 22} y={ahu.y - 22} width={44} height={44} rx={2}
          fill="hsl(var(--secondary))" stroke="hsl(var(--border))" strokeWidth={1}
        />
        <text x={ahu.x} y={ahu.y - 4} textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize={8} fontFamily="var(--font-display)" fontWeight={600}>
          AHU
        </text>
        <text x={ahu.x} y={ahu.y + 8} textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize={8} fontFamily="var(--font-display)">
          {ahu.label.split('-')[1]}
        </text>
      </g>
    ))}
  </g>
);

export default function FacilityMap({ ahuUnits, devices, nodePositions, onDeviceSelect, selectedDeviceId }: FacilityMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);

  const clampTransform = useCallback((x: number, y: number, scale: number) => {
    const s = Math.min(Math.max(scale, 0.5), 4);
    // Allow panning proportional to zoom level
    const maxPan = 300 * s;
    return {
      x: Math.min(Math.max(x, -maxPan), maxPan),
      y: Math.min(Math.max(y, -maxPan), maxPan),
      scale: s,
    };
  }, []);

  useGesture(
    {
      onDragStart: () => setIsDragging(true),
      onDragEnd: () => setIsDragging(false),
      onDrag: ({ delta: [dx, dy], event }) => {
        event.preventDefault();
        setTransform(t => clampTransform(t.x + dx, t.y + dy, t.scale));
      },
      onPinch: ({ offset: [s], event }) => {
        event.preventDefault();
        setTransform(t => clampTransform(t.x, t.y, s));
      },
      onWheel: ({ delta: [, dy], event }) => {
        event.preventDefault();
        setTransform(t => clampTransform(t.x, t.y, t.scale * Math.pow(2, -dy / 300)));
      },
    },
    {
      target: containerRef,
      drag: { filterTaps: true },
      pinch: { scaleBounds: { min: 0.5, max: 4 } },
      wheel: { eventOptions: { passive: false } },
      eventOptions: { passive: false },
    }
  );

  const zoomIn = () => setTransform(t => clampTransform(t.x, t.y, t.scale * 1.3));
  const zoomOut = () => setTransform(t => clampTransform(t.x, t.y, t.scale / 1.3));
  const resetView = () => setTransform({ x: 0, y: 0, scale: 1 });

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <PageHeader
        title="Facility Overview"
      />
      <div className="flex-1 p-6 flex flex-col overflow-hidden">

      <div
        className="border border-border bg-card overflow-hidden flex-1 relative touch-none"
        ref={containerRef}
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      >
        <div className="absolute top-3 left-3 z-10 text-[10px] text-muted-foreground font-display bg-card/90 px-2 py-1 border border-border rounded-md shadow-sm">
          78 m² · {devices.length} devices
        </div>

        <div className="absolute top-3 right-3 z-10 flex flex-col gap-1">
          <button onClick={zoomIn} className="w-8 h-8 flex items-center justify-center bg-card border border-border rounded-md text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors shadow-sm">
            <ZoomIn size={14} />
          </button>
          <button onClick={zoomOut} className="w-8 h-8 flex items-center justify-center bg-card border border-border rounded-md text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors shadow-sm">
            <ZoomOut size={14} />
          </button>
          <button onClick={resetView} className="w-8 h-8 flex items-center justify-center bg-card border border-border rounded-md text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors shadow-sm">
            <Maximize size={14} />
          </button>
        </div>

        {/* Zoom level indicator */}
        <div className="absolute bottom-3 left-3 z-10 text-[10px] text-muted-foreground font-display bg-card/90 px-2 py-1 border border-border rounded-md shadow-sm">
          {Math.round(transform.scale * 100)}%
        </div>

        {/* Legend */}
        <div className="absolute bottom-3 right-3 z-10 flex items-center gap-3 text-[10px] text-muted-foreground bg-card px-3 py-1.5 border border-border rounded-md shadow-sm">
          {['healthy', 'warning', 'fault'].map(s => (
            <span key={s} className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: `hsl(${statusColor[s]})` }} />
              <span className="capitalize">{s}</span>
            </span>
          ))}
          <span className="border-l border-border pl-3 flex items-center gap-1">
            <svg width={14} height={14} viewBox="-7 -7 14 14">
              <DeviceIconSVG color="currentColor" />
            </svg>
            <span>Vent</span>
          </span>
          <span className="border-l border-border pl-3 flex items-center gap-2">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full border" style={{ borderColor: `hsl(${airflowColor.supply})`, opacity: 0.6 }} />
              <span>Supply</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full border" style={{ borderColor: `hsl(${airflowColor.return})`, opacity: 0.6 }} />
              <span>Return</span>
            </span>
          </span>
        </div>

        <svg
          viewBox="0 0 820 620"
          className="w-full h-full"
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: 'center center',
            transition: 'none',
          }}
        >
          {/* Background grid */}
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="hsl(var(--border))" strokeWidth={0.5} opacity={0.3} />
            </pattern>
          </defs>
          <rect width="820" height="620" fill="url(#grid)" />

          {/* Floor plan structure */}
          <FloorPlanBase />

          {/* Ductwork connections */}
          <Ductwork nodePositions={nodePositions} />

          {/* Airflow visualization */}
          <AirflowOverlay devices={devices} nodePositions={nodePositions} />

          {/* AHU units */}
          <AHUNodes ahuUnits={ahuUnits} />

          {/* Devices */}
          {devices.map(device => (
            <DeviceNode
              key={device.id}
              device={device}
              selected={device.id === selectedDeviceId}
              onClick={() => onDeviceSelect(device)}
            />
          ))}
        </svg>
      </div>
      </div>
    </div>
  );
}
