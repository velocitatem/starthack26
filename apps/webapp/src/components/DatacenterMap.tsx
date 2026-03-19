import { useRef, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useGesture } from '@use-gesture/react';
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import { ModeToggle } from '@/components/mode-toggle';
import PageHeader from '@/components/PageHeader';
import { type AHUUnit, type Device } from '@/types/facility';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface DatacenterMapProps {
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

const DeviceIconSVG = ({ type, color }: { type: string; color: string }) => {
  switch (type) {
    case 'actuator':
      return (
        <g stroke={color} strokeWidth={1.5} strokeLinecap="round">
          <circle r={5.5} fill="none" />
          <line x1={0} y1={-5.5} x2={0} y2={-2.5} />
          <line x1={5.5} y1={0} x2={2.5} y2={0} />
          <line x1={0} y1={5.5} x2={0} y2={2.5} />
          <line x1={-5.5} y1={0} x2={-2.5} y2={0} />
          <circle r={2} fill={color} stroke="none" />
        </g>
      );
    case 'damper':
      return (
        <g stroke={color} strokeWidth={1.5} strokeLinecap="round">
          <rect x={-5.5} y={-4} width={11} height={8} rx={0.5} fill="none" />
          <line x1={-3.5} y1={3} x2={3.5} y2={-3} />
        </g>
      );
    case 'valve':
      return (
        <g stroke={color} strokeLinecap="round" strokeLinejoin="round">
          <path d="M-5,-3 L0,1 L-5,5 Z" fill={color} strokeWidth={0.5} />
          <path d="M5,-3 L0,1 L5,5 Z" fill={color} strokeWidth={0.5} />
          <line x1={0} y1={1} x2={0} y2={-5} strokeWidth={1.5} />
          <line x1={-2.5} y1={-5} x2={2.5} y2={-5} strokeWidth={2} />
        </g>
      );
    default:
      return null;
  }
};

const ductDevicePositions: Record<string, { x: number; y: number }> = {
  'BEL-ACT-001': { x: 70, y: 567.5 },
  'BEL-DMP-002': { x: 350, y: 155 },
  'BEL-VLV-003': { x: 200, y: 520 },
  'BEL-ACT-004': { x: 650, y: 155 },
  'BEL-VLV-005': { x: 500, y: 520 },
  'BEL-DMP-006': { x: 950, y: 155 },
  'BEL-ACT-007': { x: 800, y: 520 },
  'BEL-DMP-008': { x: 1090, y: 107.5 },
};

const supplyPalette = '187 92% 54%';
const exhaustPalette = '18 100% 62%';

const supplyBranchIds = ['BEL-VLV-003', 'BEL-VLV-005', 'BEL-ACT-007'];
const exhaustBranchIds = ['BEL-DMP-002', 'BEL-ACT-004', 'BEL-DMP-006'];

const supplyFlowPaths = [
  { id: 'BEL-VLV-003', d: 'M 200 567.5 L 200 490' },
  { id: 'BEL-VLV-005', d: 'M 500 567.5 L 500 490' },
  { id: 'BEL-ACT-007', d: 'M 800 567.5 L 800 490' },
];

const exhaustFlowPaths = [
  { id: 'BEL-DMP-002', d: 'M 350 195 L 350 107.5' },
  { id: 'BEL-ACT-004', d: 'M 650 195 L 650 107.5' },
  { id: 'BEL-DMP-006', d: 'M 950 195 L 950 107.5' },
];

const averageFlow = (nodePositions: Record<string, number>, ids: string[]) => {
  if (ids.length === 0) {
    return 0;
  }

  return ids.reduce((sum, id) => sum + (nodePositions[id] ?? 0), 0) / ids.length;
};

const DeviceNode = ({
  device,
  selected,
  onClick,
}: {
  device: Device;
  selected: boolean;
  onClick: () => void;
}) => {
  const color = `hsl(${statusColor[device.status]})`;
  const position = ductDevicePositions[device.id] ?? { x: device.x, y: device.y };
  const isHealthyValve = device.type === 'valve' && device.status === 'healthy';
  const baseFill = isHealthyValve ? `hsl(${statusColor.healthy} / 0.24)` : 'hsl(var(--card))';
  const accentFill = isHealthyValve ? `hsl(${statusColor.healthy} / 0.3)` : `hsl(${statusColor[device.status]} / 0.15)`;

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
            <circle
              cx={position.x}
              cy={position.y}
              r={18}
              fill="none"
              stroke={color}
              strokeWidth={1}
              opacity={0.45}
              className="animate-pulse-glow"
            />
          )}
          {isHealthyValve && (
            <circle
              cx={position.x}
              cy={position.y}
              r={18}
              fill="none"
              stroke={`hsl(${statusColor.healthy} / 0.55)`}
              strokeWidth={1.2}
              className="animate-pulse-glow"
            />
          )}
          {selected && (
            <circle
              cx={position.x}
              cy={position.y}
              r={16}
              fill="none"
              stroke="hsl(var(--foreground))"
              strokeWidth={1.5}
            />
          )}
          <circle cx={position.x} cy={position.y} r={12} fill={baseFill} stroke="none" />
          <circle
            cx={position.x}
            cy={position.y}
            r={12}
            fill={accentFill}
            stroke={color}
            strokeWidth={1.5}
          />
          <g transform={`translate(${position.x},${position.y})`}>
            <DeviceIconSVG type={device.type} color={color} />
          </g>
        </motion.g>
      </TooltipTrigger>
      <TooltipContent side="top" className="bg-popover border-border text-popover-foreground p-0">
        <div className="px-3 py-2">
          <div className="text-[12px] font-medium">{device.name}</div>
          <div className="text-[11px] text-muted-foreground">
            {device.id} · {device.zone}
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-[11px] capitalize">{device.status}</span>
            <span className="text-[11px] text-muted-foreground ml-1">
              Confidence Anomaly: {formatAnomalyConfidence(device.anomalyScore)}
            </span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
};

const FlowDots = ({
  d,
  flow,
  color,
}: {
  d: string;
  flow: number;
  color: string;
}) => {
  if (flow <= 0) {
    return null;
  }

  const duration = `${Math.max(1.35, 5.5 - flow * 4)}s`;
  const dotCount = flow >= 0.75 ? 4 : flow >= 0.35 ? 3 : 2;

  return (
    <g>
      <path d={d} stroke={`hsl(${color} / 0.16)`} strokeWidth={6} fill="none" strokeLinecap="round" />
      {Array.from({ length: dotCount }, (_, index) => (
        <circle key={`${d}-${index}`} r={4} fill={`hsl(${color})`} opacity={0.9}>
          <animateMotion
            dur={duration}
            begin={`${(index * Number.parseFloat(duration)) / dotCount}s`}
            repeatCount="indefinite"
            path={d}
          />
          <animate
            attributeName="opacity"
            values="0;0.92;0"
            dur={duration}
            begin={`${(index * Number.parseFloat(duration)) / dotCount}s`}
            repeatCount="indefinite"
          />
        </circle>
      ))}
    </g>
  );
};

const DuctAirflow = ({ nodePositions }: { nodePositions: Record<string, number> }) => {
  const supplyTrunkFlow = averageFlow(nodePositions, ['ahu-01', 'BEL-ACT-001', ...supplyBranchIds]);
  const exhaustTrunkFlow = averageFlow(nodePositions, ['ahu-02', 'BEL-DMP-008', ...exhaustBranchIds]);

  return (
    <g>
      <FlowDots d="M 10 567.5 L 840 567.5" flow={supplyTrunkFlow} color={supplyPalette} />
      {supplyFlowPaths.map(({ id, d }) => (
        <FlowDots key={id} d={d} flow={nodePositions[id] ?? 0} color={supplyPalette} />
      ))}

      {exhaustFlowPaths.map(({ id, d }) => (
        <FlowDots key={id} d={d} flow={nodePositions[id] ?? 0} color={exhaustPalette} />
      ))}
      <FlowDots d="M 300 107.5 L 1170 107.5" flow={exhaustTrunkFlow} color={exhaustPalette} />
    </g>
  );
};

const DatacenterBase = () => (
  <g>
    <defs>
      <rect
        id="datacenter-rack"
        x="0"
        y="0"
        width="30"
        height="23"
        fill="hsl(var(--card))"
        stroke="hsl(var(--foreground) / 0.45)"
        strokeWidth="1.5"
      />

      <g id="datacenter-rack-col">
        <use href="#datacenter-rack" x="0" y="0" />
        <use href="#datacenter-rack" x="0" y="25" />
        <use href="#datacenter-rack" x="0" y="50" />
        <use href="#datacenter-rack" x="0" y="75" />
        <use href="#datacenter-rack" x="0" y="100" />
        <use href="#datacenter-rack" x="0" y="125" />
        <use href="#datacenter-rack" x="0" y="150" />
        <use href="#datacenter-rack" x="0" y="175" />
        <use href="#datacenter-rack" x="0" y="200" />
        <use href="#datacenter-rack" x="0" y="225" />
      </g>

      <pattern id="datacenter-grid" width="40" height="40" patternUnits="userSpaceOnUse">
        <path
          d="M 40 0 L 0 0 0 40"
          fill="none"
          stroke="hsl(var(--border))"
          strokeWidth="0.75"
          opacity="0.18"
        />
      </pattern>

      <linearGradient id="datacenter-shell" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="hsl(var(--card))" />
        <stop offset="100%" stopColor="hsl(var(--secondary) / 0.8)" />
      </linearGradient>
    </defs>

    <rect width="1200" height="700" fill="url(#datacenter-grid)" />
    <rect width="1200" height="700" fill="hsl(var(--background))" opacity="0.7" />
    <rect x="40" y="40" width="1120" height="620" fill="url(#datacenter-shell)" stroke="hsl(var(--foreground) / 0.5)" strokeWidth="6" />
    <rect x="50" y="50" width="1100" height="600" fill="none" stroke="hsl(var(--foreground) / 0.25)" strokeWidth="1.5" />

    <rect x="35" y="480" width="20" height="20" fill="hsl(var(--muted))" stroke="hsl(var(--foreground) / 0.5)" strokeWidth="1.5" />
    <rect x="1145" y="480" width="20" height="20" fill="hsl(var(--muted))" stroke="hsl(var(--foreground) / 0.5)" strokeWidth="1.5" />
    <rect x="400" y="645" width="20" height="20" fill="hsl(var(--muted))" stroke="hsl(var(--foreground) / 0.5)" strokeWidth="1.5" />
    <rect x="750" y="645" width="20" height="20" fill="hsl(var(--muted))" stroke="hsl(var(--foreground) / 0.5)" strokeWidth="1.5" />

    <rect x="180" y="220" width="40" height="250" fill="hsl(var(--secondary) / 0.85)" />
    <use href="#datacenter-rack-col" x="150" y="220" />
    <use href="#datacenter-rack-col" x="220" y="220" />

    <rect x="330" y="220" width="40" height="250" fill="hsl(var(--muted-foreground) / 0.5)" />
    <rect x="325" y="470" width="50" height="20" fill="hsl(var(--muted-foreground) / 0.5)" stroke="hsl(var(--foreground) / 0.4)" strokeWidth="1.5" />
    <use href="#datacenter-rack-col" x="300" y="220" />
    <use href="#datacenter-rack-col" x="370" y="220" />

    <rect x="480" y="220" width="40" height="250" fill="hsl(var(--secondary) / 0.85)" />
    <use href="#datacenter-rack-col" x="450" y="220" />
    <use href="#datacenter-rack-col" x="520" y="220" />

    <rect x="630" y="220" width="40" height="250" fill="hsl(var(--muted-foreground) / 0.5)" />
    <rect x="625" y="470" width="50" height="20" fill="hsl(var(--muted-foreground) / 0.5)" stroke="hsl(var(--foreground) / 0.4)" strokeWidth="1.5" />
    <use href="#datacenter-rack-col" x="600" y="220" />
    <use href="#datacenter-rack-col" x="670" y="220" />

    <rect x="780" y="220" width="40" height="250" fill="hsl(var(--secondary) / 0.85)" />
    <use href="#datacenter-rack-col" x="750" y="220" />
    <use href="#datacenter-rack-col" x="820" y="220" />

    <rect x="930" y="220" width="40" height="250" fill="hsl(var(--muted-foreground) / 0.5)" />
    <rect x="925" y="470" width="50" height="20" fill="hsl(var(--muted-foreground) / 0.5)" stroke="hsl(var(--foreground) / 0.4)" strokeWidth="1.5" />
    <use href="#datacenter-rack-col" x="900" y="220" />
    <use href="#datacenter-rack-col" x="970" y="220" />

    <path
      d="M 300 90 L 1150 90 L 1150 125 L 965 125 L 965 180 L 935 180 L 935 125 L 665 125 L 665 180 L 635 180 L 635 125 L 365 125 L 365 180 L 335 180 L 335 125 L 300 125 Z"
      fill="hsl(var(--muted-foreground) / 0.38)"
      stroke="hsl(var(--foreground) / 0.55)"
      strokeWidth="1.5"
    />
    <polygon points="335,180 365,180 375,195 325,195" fill="hsl(var(--muted-foreground) / 0.38)" stroke="hsl(var(--foreground) / 0.55)" strokeWidth="1.5" />
    <polygon points="635,180 665,180 675,195 625,195" fill="hsl(var(--muted-foreground) / 0.38)" stroke="hsl(var(--foreground) / 0.55)" strokeWidth="1.5" />
    <polygon points="935,180 965,180 975,195 925,195" fill="hsl(var(--muted-foreground) / 0.38)" stroke="hsl(var(--foreground) / 0.55)" strokeWidth="1.5" />
    <polygon points="1150,90 1150,125 1170,135 1170,80" fill="hsl(var(--muted-foreground) / 0.38)" stroke="hsl(var(--foreground) / 0.55)" strokeWidth="1.5" />

    <rect x="335" y="145" width="30" height="20" fill="none" stroke="hsl(var(--foreground) / 0.65)" strokeWidth="1.5" />
    <rect x="635" y="145" width="30" height="20" fill="none" stroke="hsl(var(--foreground) / 0.65)" strokeWidth="1.5" />
    <rect x="935" y="145" width="30" height="20" fill="none" stroke="hsl(var(--foreground) / 0.65)" strokeWidth="1.5" />
    <rect x="1080" y="90" width="20" height="35" fill="none" stroke="hsl(var(--foreground) / 0.65)" strokeWidth="1.5" />

    <path
      d="M 100 550 L 185 550 L 185 490 L 215 490 L 215 550 L 485 550 L 485 490 L 515 490 L 515 550 L 785 550 L 785 490 L 815 490 L 815 550 L 840 550 L 840 585 L 20 585 L 20 550 Z"
      fill="hsl(var(--muted-foreground) / 0.38)"
      stroke="hsl(var(--foreground) / 0.55)"
      strokeWidth="1.5"
    />
    <polygon points="20,550 20,585 10,595 10,540" fill="hsl(var(--muted-foreground) / 0.38)" stroke="hsl(var(--foreground) / 0.55)" strokeWidth="1.5" />

    <rect x="185" y="510" width="30" height="20" fill="none" stroke="hsl(var(--foreground) / 0.65)" strokeWidth="1.5" />
    <rect x="485" y="510" width="30" height="20" fill="none" stroke="hsl(var(--foreground) / 0.65)" strokeWidth="1.5" />
    <rect x="785" y="510" width="30" height="20" fill="none" stroke="hsl(var(--foreground) / 0.65)" strokeWidth="1.5" />
    <rect x="60" y="550" width="20" height="35" fill="none" stroke="hsl(var(--foreground) / 0.65)" strokeWidth="1.5" />

    <text x="78" y="615" fill={`hsl(${supplyPalette})`} fontSize="12" fontFamily="var(--font-display)">
      INTAKE
    </text>
    <text x="1028" y="78" fill={`hsl(${exhaustPalette})`} fontSize="12" fontFamily="var(--font-display)">
      EXHAUST
    </text>
  </g>
);

export default function DatacenterMap({
  ahuUnits: _ahuUnits,
  devices,
  nodePositions,
  onDeviceSelect,
  selectedDeviceId,
}: DatacenterMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);

  const clampTransform = useCallback((x: number, y: number, scale: number) => {
    const s = Math.min(Math.max(scale, 0.45), 3.2);
    const maxPanX = 360 * s;
    const maxPanY = 220 * s;

    return {
      x: Math.min(Math.max(x, -maxPanX), maxPanX),
      y: Math.min(Math.max(y, -maxPanY), maxPanY),
      scale: s,
    };
  }, []);

  useGesture(
    {
      onDragStart: () => setIsDragging(true),
      onDragEnd: () => setIsDragging(false),
      onDrag: ({ delta: [dx, dy], event }) => {
        event.preventDefault();
        setTransform((current) => clampTransform(current.x + dx, current.y + dy, current.scale));
      },
      onPinch: ({ offset: [scale], event }) => {
        event.preventDefault();
        setTransform((current) => clampTransform(current.x, current.y, scale));
      },
      onWheel: ({ delta: [, dy], event }) => {
        event.preventDefault();
        const factor = dy > 0 ? 0.95 : 1.05;
        setTransform((current) => clampTransform(current.x, current.y, current.scale * factor));
      },
    },
    {
      target: containerRef,
      drag: { filterTaps: true },
      pinch: { scaleBounds: { min: 0.45, max: 3.2 } },
      wheel: { eventOptions: { passive: false } },
      eventOptions: { passive: false },
    },
  );

  const zoomIn = () => setTransform((current) => clampTransform(current.x, current.y, current.scale * 1.25));
  const zoomOut = () => setTransform((current) => clampTransform(current.x, current.y, current.scale / 1.25));
  const resetView = () => setTransform({ x: 0, y: 0, scale: 1 });

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <PageHeader
        title="Datacenter Overview"
        subtitle={`Rows A-F · ${devices.length} devices`}
        actions={<ModeToggle />}
      />
      <div className="flex-1 p-6 flex flex-col overflow-hidden">
        <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15, ease: [0.2, 0, 0, 1] }}
        className="border border-border bg-card overflow-hidden flex-1 relative touch-none"
        ref={containerRef}
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      >
        <div className="absolute top-3 right-3 z-10 flex flex-col gap-1">
          <button
            onClick={zoomIn}
            className="w-8 h-8 flex items-center justify-center bg-card border border-border rounded-md text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors shadow-sm"
          >
            <ZoomIn size={14} />
          </button>
          <button
            onClick={zoomOut}
            className="w-8 h-8 flex items-center justify-center bg-card border border-border rounded-md text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors shadow-sm"
          >
            <ZoomOut size={14} />
          </button>
          <button
            onClick={resetView}
            className="w-8 h-8 flex items-center justify-center bg-card border border-border rounded-md text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors shadow-sm"
          >
            <Maximize size={14} />
          </button>
        </div>

        <div className="absolute bottom-3 left-3 z-10 text-[10px] text-muted-foreground font-display bg-card/90 px-2 py-1 border border-border rounded-md shadow-sm">
          {Math.round(transform.scale * 100)}%
        </div>

        <div className="absolute bottom-3 right-3 z-10 flex items-center gap-3 text-[10px] text-muted-foreground bg-card px-3 py-1.5 border border-border rounded-md shadow-sm">
          {['healthy', 'warning', 'fault'].map((status) => (
            <span key={status} className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: `hsl(${statusColor[status]})` }} />
              <span className="capitalize">{status}</span>
            </span>
          ))}
          <span className="border-l border-border pl-3 flex items-center gap-2.5">
            {(['actuator', 'damper', 'valve'] as const).map((type, index) => (
              <span key={type} className="flex items-center gap-1">
                <svg width={14} height={14} viewBox="-7 -7 14 14">
                  <DeviceIconSVG type={type} color="currentColor" />
                </svg>
                <span>{['Act', 'Dmp', 'Vlv'][index]}</span>
              </span>
            ))}
          </span>
          <span className="border-l border-border pl-3 flex items-center gap-2">
            <span className="w-4 h-1 rounded-full" style={{ backgroundColor: `hsl(${supplyPalette})` }} />
            <span>Supply</span>
            <span className="w-4 h-1 rounded-full ml-2" style={{ backgroundColor: `hsl(${exhaustPalette})` }} />
            <span>Exhaust</span>
          </span>
        </div>

        <svg
          viewBox="0 0 1200 700"
          className="w-full h-full"
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: 'center center',
            transition: 'none',
          }}
        >
          <DatacenterBase />
          <DuctAirflow nodePositions={nodePositions} />
          {devices.map((device) => (
            <DeviceNode
              key={device.id}
              device={device}
              selected={device.id === selectedDeviceId}
              onClick={() => onDeviceSelect(device)}
            />
          ))}
        </svg>
        </motion.div>
      </div>
    </div>
  );
}
