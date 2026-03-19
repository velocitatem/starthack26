import { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useGesture } from '@use-gesture/react';
import { ZoomIn, ZoomOut, Maximize, Play, RotateCcw, Bug, LoaderCircle } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import { type AHUUnit, type Device, type SimulationFailureInput, type SimulationRunResponse } from '@/types/facility';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { useSimulationRun } from '@/hooks/useSimulationRun';

interface DatacenterMapProps {
  ahuUnits: AHUUnit[];
  devices: Device[];
  nodePositions: Record<string, number>;
  onDeviceSelect: (device: Device) => void;
  onDeviceHover?: (device: Device) => void;
  onDeviceHoverEnd?: () => void;
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

const ductDevicePositions: Record<string, { x: number; y: number }> = {
  'BEL-VNT-001': { x: 70, y: 567.5 },
  'BEL-VNT-002': { x: 350, y: 155 },
  'BEL-VNT-003': { x: 200, y: 520 },
  'BEL-VNT-004': { x: 650, y: 155 },
  'BEL-VNT-005': { x: 500, y: 520 },
  'BEL-VNT-006': { x: 950, y: 155 },
  'BEL-VNT-007': { x: 800, y: 520 },
  'BEL-VNT-008': { x: 1090, y: 107.5 },
};

const supplyPalette = '187 92% 54%';
const exhaustPalette = '18 100% 62%';

const supplyBranchIds = ['BEL-VNT-003', 'BEL-VNT-005', 'BEL-VNT-007'];
const exhaustBranchIds = ['BEL-VNT-002', 'BEL-VNT-004', 'BEL-VNT-006'];

const supplyFlowPaths = [
  { id: 'BEL-VNT-003', d: 'M 200 567.5 L 200 490' },
  { id: 'BEL-VNT-005', d: 'M 500 567.5 L 500 490' },
  { id: 'BEL-VNT-007', d: 'M 800 567.5 L 800 490' },
];

const exhaustFlowPaths = [
  { id: 'BEL-VNT-002', d: 'M 350 195 L 350 107.5' },
  { id: 'BEL-VNT-004', d: 'M 650 195 L 650 107.5' },
  { id: 'BEL-VNT-006', d: 'M 950 195 L 950 107.5' },
];

const thermalLanes = [
  {
    key: 'lane-ab',
    supplyId: 'BEL-VNT-003',
    exhaustId: 'BEL-VNT-002',
    supplyX: 200,
    hotX: 350,
    coldRow: 'row_a' as const,
    hotRow: 'row_b' as const,
  },
  {
    key: 'lane-cd',
    supplyId: 'BEL-VNT-005',
    exhaustId: 'BEL-VNT-004',
    supplyX: 500,
    hotX: 650,
    coldRow: 'row_c' as const,
    hotRow: 'row_d' as const,
  },
  {
    key: 'lane-ef',
    supplyId: 'BEL-VNT-007',
    exhaustId: 'BEL-VNT-006',
    supplyX: 800,
    hotX: 950,
    coldRow: 'row_e' as const,
    hotRow: 'row_f' as const,
  },
] as const;

const laneHeights = [258, 345, 432];

const buildColdSupplyPath = (supplyX: number, laneY: number, offset = 0) =>
  `M 18 567.5 L ${supplyX} 567.5 L ${supplyX} 490 L ${supplyX + offset} ${laneY}`;

const buildServerPassPath = (supplyX: number, hotX: number, laneY: number, lift = 0) =>
  `M ${supplyX} ${laneY} C ${supplyX + 26} ${laneY - 6 - lift}, ${hotX - 26} ${laneY + 6 - lift}, ${hotX} ${laneY - lift}`;

const buildHotRisePath = (hotX: number, laneY: number, drift = 0) =>
  `M ${hotX} ${laneY} C ${hotX + 18 + drift} ${laneY - 34}, ${hotX - 12 + drift} ${laneY - 92}, ${hotX} 195 ` +
  `L ${hotX} 107.5 L 1170 107.5`;

const buildIntakePortPath = () => 'M 82 567.5 C 62 567.5, 42 567.5, 18 567.5';
const buildExhaustPortPath = () => 'M 1118 107.5 C 1140 107.5, 1162 107.5, 1188 107.5';

const averageFlow = (nodePositions: Record<string, number>, ids: string[]) => {
  if (ids.length === 0) {
    return 0;
  }

  return ids.reduce((sum, id) => sum + (nodePositions[id] ?? 0), 0) / ids.length;
};

const SIMULATION_INTERVAL_MS = 80;
const PLAYBACK_WARMUP_STEPS = 18;
const SIMULATION_DURATION_SECONDS = 300;
const DUCT_PARTICLE_DENSITY_MULTIPLIER = 1.8;
const THERMAL_PARTICLE_DENSITY_MULTIPLIER = 2.1;

type RowId = 'row_a' | 'row_b' | 'row_c' | 'row_d' | 'row_e' | 'row_f';

const rowOverlays: Array<{ id: RowId; label: string; x: number; y: number; width: number; height: number }> = [
  { id: 'row_a', label: 'ROW A', x: 146, y: 214, width: 108, height: 280 },
  { id: 'row_b', label: 'ROW B', x: 296, y: 214, width: 108, height: 280 },
  { id: 'row_c', label: 'ROW C', x: 446, y: 214, width: 108, height: 280 },
  { id: 'row_d', label: 'ROW D', x: 596, y: 214, width: 108, height: 280 },
  { id: 'row_e', label: 'ROW E', x: 746, y: 214, width: 108, height: 280 },
  { id: 'row_f', label: 'ROW F', x: 896, y: 214, width: 108, height: 280 },
];

const defaultBaselineRowTemperatures: Record<RowId, number> = {
  row_a: 22.4,
  row_b: 31.6,
  row_c: 22.6,
  row_d: 31.5,
  row_e: 22.5,
  row_f: 32.1,
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const smoothStep = (edge0: number, edge1: number, value: number) => {
  if (edge0 === edge1) {
    return value < edge0 ? 0 : 1;
  }
  const x = clamp01((value - edge0) / (edge1 - edge0));
  return x * x * (3 - 2 * x);
};

const buildRowTemperatures = (progress: number): Record<RowId, number> => {
  const surge = smoothStep(0.08, 0.56, progress);
  const settle = smoothStep(0.58, 1.0, progress);
  const pulse = Math.sin(progress * Math.PI * 8) * (1 - settle) * 0.2;

  return {
    row_a: defaultBaselineRowTemperatures.row_a + 0.8 * surge,
    row_b: defaultBaselineRowTemperatures.row_b + 2.3 * surge + 0.7 * settle,
    row_c: defaultBaselineRowTemperatures.row_c + 0.9 * surge,
    row_d: defaultBaselineRowTemperatures.row_d + 2.6 * surge + 0.9 * settle,
    row_e: defaultBaselineRowTemperatures.row_e + 6.0 * surge + 1.1 * settle + pulse,
    row_f: defaultBaselineRowTemperatures.row_f + 11.8 * surge + 2.3 * settle + 1.5 * pulse,
  };
};

const thermalColor = (deltaC: number) => {
  const normalized = clamp01((deltaC + 1.0) / 14.0);
  const hue = 198 - normalized * 182;
  const saturation = 88;
  const lightness = 52 - normalized * 16;
  const alpha = 0.07 + normalized * 0.32;

  return {
    fill: `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`,
    stroke: `hsla(${hue}, ${Math.max(45, saturation - 20)}%, ${Math.max(26, lightness - 12)}%, 0.75)`,
  };
};

const thermalParticleColor = (temperatureC: number) => {
  return temperatureC < 34 ? supplyPalette : exhaustPalette;
};

const thermalDriveFromAisle = (coldTempC: number, hotTempC: number) => {
  const hotNorm = clamp01((hotTempC - 30) / 18);
  const deltaNorm = clamp01((hotTempC - coldTempC - 6) / 12);
  return clamp01(0.55 * hotNorm + 0.45 * deltaNorm);
};

const deviceToComponentId: Record<string, string> = {
  'BEL-VNT-001': 'act_intake',
  'BEL-VNT-002': 'dmp_ab',
  'BEL-VNT-003': 'vlv_ab',
  'BEL-VNT-004': 'act_cd_exhaust',
  'BEL-VNT-005': 'vlv_cd',
  'BEL-VNT-006': 'dmp_ef',
  'BEL-VNT-007': 'act_ef_supply',
  'BEL-VNT-008': 'dmp_outlet',
};

const buildSimulationFailures = (devices: Device[]): SimulationFailureInput[] => {
  const failures = devices.flatMap((device) => {
    const componentId = deviceToComponentId[device.id];
    if (!componentId) {
      return [];
    }

    if (device.status === 'fault') {
      const mode = device.faults[0]?.type?.toLowerCase().includes('gear') ? 'gear_stuck' : 'stuck';
      return [{ componentId, mode, severity: Math.max(0.72, device.anomalyScore), startSeconds: 0 }];
    }

    if (device.status === 'warning') {
      return [{ componentId, mode: 'degraded', severity: Math.max(0.38, device.anomalyScore), startSeconds: 0 }];
    }

    return [];
  });

  if (failures.length === 0) {
    return [{ componentId: 'dmp_ef', mode: 'stuck', severity: 0.92, startSeconds: 0 }];
  }

  return failures;
};

const timelineAt = (series: number[] | undefined, index: number, fallback: number) => {
  if (!series || series.length === 0) {
    return fallback;
  }
  const safeIndex = Math.min(Math.max(index, 0), series.length - 1);
  return series[safeIndex];
};

const lerp = (from: number, to: number, blend: number) => from + (to - from) * blend;
const isPulsingStatus = (status: Device['status'] | undefined) =>
  status === 'warning' || status === 'fault' || status === 'offline';

const statusPassthroughFactor: Record<Device['status'], number> = {
  healthy: 1,
  warning: 0.72,
  fault: 0.38,
  offline: 0.14,
};

const passthroughFromStatus = (status: Device['status'] | undefined) => {
  if (!status) {
    return 1;
  }
  return statusPassthroughFactor[status] ?? 1;
};

const DeviceNode = ({
  device,
  selected,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: {
  device: Device;
  selected: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) => {
  const color = `hsl(${statusColor[device.status]})`;
  const position = ductDevicePositions[device.id] ?? { x: device.x, y: device.y };

  return (
    <motion.g
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
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
      <circle cx={position.x} cy={position.y} r={12} fill="hsl(var(--card))" stroke="none" />
      <circle
        cx={position.x}
        cy={position.y}
        r={12}
        fill={`hsl(${statusColor[device.status]} / 0.15)`}
        stroke={color}
        strokeWidth={1.5}
      />
      <g transform={`translate(${position.x},${position.y})`}>
        <DeviceIconSVG color={color} />
      </g>
    </motion.g>
  );
};

const FlowDots = ({
  d,
  flow,
  color,
  pulsing = false,
}: {
  d: string;
  flow: number;
  color: string;
  pulsing?: boolean;
}) => {
  if (flow <= 0) {
    return null;
  }

  const duration = `${Math.max(1.35, 5.5 - flow * 4)}s`;
  const baseCount = flow >= 0.85 ? 6 : flow >= 0.6 ? 5 : flow >= 0.35 ? 4 : 3;
  const dotCount = Math.min(14, Math.max(3, Math.round(baseCount * DUCT_PARTICLE_DENSITY_MULTIPLIER)));
  const durationSeconds = Number.parseFloat(duration);

  return (
    <g>
      <path d={d} stroke={`hsl(${color} / 0.16)`} strokeWidth={6} fill="none" strokeLinecap="round" />
      {Array.from({ length: dotCount }, (_, index) => (
        <circle key={`${d}-${index}`} r={4} fill={`hsl(${color})`} opacity={0.9}>
          <animateMotion
            dur={duration}
            begin={`${(pulsing ? index * durationSeconds * 0.16 : (index * durationSeconds) / dotCount).toFixed(2)}s`}
            repeatCount="indefinite"
            path={d}
          />
          <animate
            attributeName="opacity"
            values={pulsing ? '0;0;1;0.2;0;0' : '0;0.92;0'}
            dur={duration}
            begin={`${(pulsing ? index * durationSeconds * 0.16 : (index * durationSeconds) / dotCount).toFixed(2)}s`}
            repeatCount="indefinite"
            keyTimes={pulsing ? '0;0.18;0.28;0.46;0.7;1' : undefined}
          />
          <animate
            attributeName="r"
            values={pulsing ? '2.4;4.5;3.2;2.4' : '3.2;4.2;3.2'}
            dur={duration}
            begin={`${(pulsing ? index * durationSeconds * 0.16 : (index * durationSeconds) / dotCount).toFixed(2)}s`}
            repeatCount="indefinite"
            keyTimes={pulsing ? '0;0.22;0.72;1' : undefined}
          />
        </circle>
      ))}
    </g>
  );
};

const ThermalParticleStream = ({
  path,
  flow,
  pulsing,
  color,
  radiusValues,
  durationScale = 1,
}: {
  path: string;
  flow: number;
  pulsing: boolean;
  color: string;
  radiusValues: string;
  durationScale?: number;
}) => {
  if (flow <= 0) {
    return null;
  }

  const durationSeconds = Math.max(4.8, 11 - flow * 6.8) * durationScale;
  const duration = `${durationSeconds}s`;
  const baseCount = flow >= 1.1 ? 8 : flow >= 0.8 ? 7 : flow >= 0.45 ? 5 : 3;
  const particleCount = Math.min(16, Math.max(3, Math.round(baseCount * THERMAL_PARTICLE_DENSITY_MULTIPLIER)));
  const burstWindow = pulsing ? durationSeconds * 0.18 : durationSeconds / particleCount;

  return (
    <g>
      {Array.from({ length: particleCount }, (_, index) => {
        const begin = `${(pulsing ? index * burstWindow : (index * durationSeconds) / particleCount).toFixed(2)}s`;
        const opacityValues = pulsing ? '0;0;1;0.15;0;0' : '0;1;0.25;0';
        const opacityTimes = pulsing ? '0;0.18;0.32;0.48;0.68;1' : '0;0.18;0.78;1';

        return (
          <circle key={`${path}-${index}`} r={3.6} fill={`hsl(${color})`} opacity={0}>
            <animateMotion dur={duration} begin={begin} repeatCount="indefinite" path={path} rotate="auto" />
            <animate
              attributeName="opacity"
              dur={duration}
              begin={begin}
              repeatCount="indefinite"
              values={opacityValues}
              keyTimes={opacityTimes}
            />
            <animate
              attributeName="r"
              dur={duration}
              begin={begin}
              repeatCount="indefinite"
              values={radiusValues}
              keyTimes="0;0.2;0.75;1"
            />
          </circle>
        );
      })}
    </g>
  );
};

const PortBreathing = ({
  flow,
  type,
  pulsing,
  temperatureC,
}: {
  flow: number;
  type: 'intake' | 'exhaust';
  pulsing: boolean;
  temperatureC?: number;
}) => {
  if (flow <= 0) {
    return null;
  }

  const thermalDrive = temperatureC === undefined ? 0 : clamp01((temperatureC - 24) / 20);
  const durationSeconds = Math.max(1.8, (4.4 - flow * 2) * (1 - 0.32 * thermalDrive));
  const duration = `${durationSeconds}s`;
  const isIntake = type === 'intake';
  const cx = isIntake ? 18 : 1172;
  const cy = isIntake ? 567.5 : 107.5;
  const stroke = temperatureC === undefined
    ? isIntake
      ? supplyPalette
      : exhaustPalette
    : thermalParticleColor(temperatureC);
  const path = isIntake ? buildIntakePortPath() : buildExhaustPortPath();

  return (
    <g>
      {Array.from({ length: 3 }, (_, index) => {
        const begin = `${(index * durationSeconds) / 3}s`;
        return (
          <ellipse
            key={`${type}-ring-${index}`}
            cx={cx}
            cy={cy}
            rx={isIntake ? 28 : 10}
            ry={isIntake ? 18 : 7}
            fill="none"
            stroke={`hsl(${stroke} / 0.45)`}
            strokeWidth={1.1}
            opacity={0}
          >
            <animate
              attributeName="rx"
              dur={duration}
              begin={begin}
              repeatCount="indefinite"
              values={isIntake ? '32;18;8' : '10;24;38'}
            />
            <animate
              attributeName="ry"
              dur={duration}
              begin={begin}
              repeatCount="indefinite"
              values={isIntake ? '20;11;4' : '7;14;22'}
            />
            <animate
              attributeName="opacity"
              dur={duration}
              begin={begin}
              repeatCount="indefinite"
              values={pulsing ? '0;0;0.65;0.18;0' : '0;0.65;0.15;0'}
              keyTimes={pulsing ? '0;0.18;0.32;0.62;1' : undefined}
            />
          </ellipse>
        );
      })}
      <ThermalParticleStream
        path={path}
        flow={flow}
        pulsing={pulsing}
        color={stroke}
        radiusValues={
          isIntake
            ? `${(2.2 + thermalDrive * 0.2).toFixed(1)};${(3.4 + thermalDrive * 0.5).toFixed(1)};${(2.6 + thermalDrive * 0.3).toFixed(1)};2.0`
            : `${(2.6 + thermalDrive * 0.4).toFixed(1)};${(4.0 + thermalDrive * 0.9).toFixed(1)};${(3.2 + thermalDrive * 0.8).toFixed(1)};2.4`
        }
        durationScale={Math.max(0.5, 0.72 - thermalDrive * 0.16)}
      />
    </g>
  );
};

const ThermodynamicAirflow = ({
  devices,
  nodePositions,
  rowTemperatures,
}: {
  devices: Device[];
  nodePositions: Record<string, number>;
  rowTemperatures: Record<RowId, number>;
}) => {
  const deviceById = Object.fromEntries(devices.map((device) => [device.id, device]));
  const intakeFactor = passthroughFromStatus(deviceById['BEL-VNT-001']?.status);
  const outletFactor = passthroughFromStatus(deviceById['BEL-VNT-008']?.status);
  const intakeFlow = Math.min(nodePositions['ahu-01'] ?? 0, nodePositions['BEL-VNT-001'] ?? 0) * intakeFactor;
  const exhaustPortFlow = Math.min(nodePositions['ahu-02'] ?? 0, nodePositions['BEL-VNT-008'] ?? 0) * outletFactor;
  const edgePulsing = isPulsingStatus(deviceById['BEL-VNT-001']?.status) || isPulsingStatus(deviceById['BEL-VNT-008']?.status);
  const intakeTemperature = (rowTemperatures.row_a + rowTemperatures.row_c + rowTemperatures.row_e) / 3;
  const exhaustTemperature = (rowTemperatures.row_b + rowTemperatures.row_d + rowTemperatures.row_f) / 3;

  return (
    <g>
      <PortBreathing flow={intakeFlow} type="intake" pulsing={edgePulsing} temperatureC={intakeTemperature} />
      <PortBreathing flow={exhaustPortFlow} type="exhaust" pulsing={edgePulsing} temperatureC={exhaustTemperature} />
      {thermalLanes.map(({ key, supplyId, exhaustId, supplyX, hotX, coldRow, hotRow }) => {
        const supplyFactor = passthroughFromStatus(deviceById[supplyId]?.status);
        const exhaustFactor = passthroughFromStatus(deviceById[exhaustId]?.status);
        const laneFactor = Math.min(supplyFactor, exhaustFactor);
        const routeFlow = Math.min(
          nodePositions[supplyId] ?? 0,
          nodePositions[exhaustId] ?? 0,
          intakeFlow,
          exhaustPortFlow,
        ) * laneFactor;
        const coldTemp = rowTemperatures[coldRow];
        const hotTemp = rowTemperatures[hotRow];
        const thermalDrive = thermalDriveFromAisle(coldTemp, hotTemp);
        const coldColor = thermalParticleColor(coldTemp);
        const hotColor = thermalParticleColor(hotTemp);
        const pulsing = [supplyId, exhaustId].some((id) => {
          const status = deviceById[id]?.status;
          return isPulsingStatus(status);
        }) || thermalDrive > 0.52;

        const coldFlow = routeFlow * (1 + 0.22 * thermalDrive);
        const crossFlow = routeFlow * (0.92 + 0.25 * thermalDrive);
        const hotFlow = routeFlow * (0.88 + 0.52 * thermalDrive);
        const hotDurationScale = Math.max(0.52, 1.22 - 0.36 * thermalDrive);
        const coldDurationScale = Math.max(0.52, 0.95 - 0.2 * thermalDrive);

        return laneHeights.map((laneY) => {
          const guideKey = `${key}-${laneY}`;
          const coldPath = buildColdSupplyPath(supplyX, laneY);
          const crossPath = buildServerPassPath(supplyX, hotX, laneY);
          const hotPath = buildHotRisePath(hotX, laneY);
          return (
            <g key={guideKey}>
              <path
                d={coldPath}
                stroke={`hsl(${supplyPalette} / 0.1)`}
                strokeWidth={5}
                fill="none"
                strokeLinecap="round"
              />
              <path
                d={crossPath}
                stroke={`hsl(${supplyPalette} / 0.09)`}
                strokeWidth={4}
                fill="none"
                strokeLinecap="round"
              />
              <path
                d={hotPath}
                stroke={`hsl(${exhaustPalette} / 0.1)`}
                strokeWidth={5}
                fill="none"
                strokeLinecap="round"
              />
              <ThermalParticleStream
                path={coldPath}
                flow={coldFlow}
                pulsing={pulsing}
                color={coldColor}
                radiusValues={`${(2.1 + thermalDrive * 0.2).toFixed(1)};${(3.2 + thermalDrive * 0.4).toFixed(1)};${(2.7 + thermalDrive * 0.35).toFixed(1)};2.2`}
                durationScale={coldDurationScale}
              />
              <ThermalParticleStream
                path={crossPath}
                flow={crossFlow}
                pulsing={pulsing}
                color={thermalParticleColor((coldTemp + hotTemp) * 0.5)}
                radiusValues={`${(2.3 + thermalDrive * 0.25).toFixed(1)};${(3.5 + thermalDrive * 0.7).toFixed(1)};${(3.1 + thermalDrive * 0.8).toFixed(1)};2.5`}
                durationScale={Math.max(0.56, 1.02 - 0.26 * thermalDrive)}
              />
              <ThermalParticleStream
                path={hotPath}
                flow={hotFlow}
                pulsing={pulsing}
                color={hotColor}
                radiusValues={`${(2.9 + thermalDrive * 0.35).toFixed(1)};${(4.4 + thermalDrive * 1.0).toFixed(1)};${(4.0 + thermalDrive * 0.9).toFixed(1)};2.9`}
                durationScale={hotDurationScale}
              />
            </g>
          );
        });
      })}
    </g>
  );
};

const DuctAirflow = ({
  devices,
  nodePositions,
}: {
  devices: Device[];
  nodePositions: Record<string, number>;
}) => {
  const deviceById = Object.fromEntries(devices.map((device) => [device.id, device]));
  const intakeFactor = passthroughFromStatus(deviceById['BEL-VNT-001']?.status);
  const outletFactor = passthroughFromStatus(deviceById['BEL-VNT-008']?.status);
  const supplyTrunkFlow =
    averageFlow(nodePositions, ['ahu-01', 'BEL-VNT-001', ...supplyBranchIds]) * intakeFactor;
  const exhaustTrunkFlow =
    averageFlow(nodePositions, ['ahu-02', 'BEL-VNT-008', ...exhaustBranchIds]) * outletFactor;
  const supplyPulsing = isPulsingStatus(deviceById['BEL-VNT-001']?.status);
  const exhaustPulsing = isPulsingStatus(deviceById['BEL-VNT-008']?.status);

  return (
    <g>
      <FlowDots d="M 10 567.5 L 840 567.5" flow={supplyTrunkFlow} color={supplyPalette} pulsing={supplyPulsing} />
      {supplyFlowPaths.map(({ id, d }) => {
        const branchFactor = passthroughFromStatus(deviceById[id]?.status);
        const branchFlow = (nodePositions[id] ?? 0) * branchFactor;
        return (
        <FlowDots
          key={id}
          d={d}
          flow={branchFlow}
          color={supplyPalette}
          pulsing={isPulsingStatus(deviceById[id]?.status)}
        />
        );
      })}

      {exhaustFlowPaths.map(({ id, d }) => {
        const branchFactor = passthroughFromStatus(deviceById[id]?.status);
        const branchFlow = (nodePositions[id] ?? 0) * branchFactor;
        return (
        <FlowDots
          key={id}
          d={d}
          flow={branchFlow}
          color={exhaustPalette}
          pulsing={isPulsingStatus(deviceById[id]?.status)}
        />
        );
      })}
      <FlowDots d="M 300 107.5 L 1170 107.5" flow={exhaustTrunkFlow} color={exhaustPalette} pulsing={exhaustPulsing} />
    </g>
  );
};

const ThermalOverlay = ({
  rowTemperatures,
  baselineTemperatures,
}: {
  rowTemperatures: Record<RowId, number>;
  baselineTemperatures: Record<RowId, number>;
}) => (
  <g pointerEvents="none">
    {rowOverlays.map((row) => {
      const deltaC = rowTemperatures[row.id] - baselineTemperatures[row.id];
      const color = thermalColor(deltaC);

      return (
        <g key={row.id}>
          <rect
            x={row.x}
            y={row.y}
            width={row.width}
            height={row.height}
            rx={8}
            fill={color.fill}
            stroke={color.stroke}
            strokeWidth={1}
          />
          <text
            x={row.x + row.width / 2}
            y={row.y + 16}
            textAnchor="middle"
            fontSize="10"
            fontFamily="var(--font-display)"
            fill="hsl(var(--foreground) / 0.86)"
          >
            {row.label} {rowTemperatures[row.id].toFixed(1)}C ({deltaC >= 0 ? '+' : ''}{deltaC.toFixed(1)}C)
          </text>
        </g>
      );
    })}
  </g>
);

const DatacenterBase = () => (
  <g>
    <defs>
      <rect
        id="datacenter-rack"
        x="0"
        y="0"
        width="30"
        height="23"
        fill="hsl(var(--map-floor))"
        stroke="hsl(var(--foreground) / 0.5)"
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
          stroke="hsl(var(--foreground) / 0.07)"
          strokeWidth="0.75"
        />
      </pattern>

      <linearGradient id="datacenter-shell" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="hsl(var(--map-floor))" />
        <stop offset="100%" stopColor="hsl(var(--map-aisle) / 0.85)" />
      </linearGradient>
    </defs>

    <rect width="1200" height="700" fill="url(#datacenter-grid)" />
    <rect width="1200" height="700" fill="hsl(var(--background) / 0.45)" />
    <rect x="40" y="40" width="1120" height="620" fill="url(#datacenter-shell)" stroke="hsl(var(--foreground) / 0.55)" strokeWidth="6" />
    <rect x="50" y="50" width="1100" height="600" fill="none" stroke="hsl(var(--foreground) / 0.3)" strokeWidth="1.5" />

    <rect x="35" y="480" width="20" height="20" fill="hsl(var(--map-aisle))" stroke="hsl(var(--foreground) / 0.55)" strokeWidth="1.5" />
    <rect x="1145" y="480" width="20" height="20" fill="hsl(var(--map-aisle))" stroke="hsl(var(--foreground) / 0.55)" strokeWidth="1.5" />
    <rect x="400" y="645" width="20" height="20" fill="hsl(var(--map-aisle))" stroke="hsl(var(--foreground) / 0.55)" strokeWidth="1.5" />
    <rect x="750" y="645" width="20" height="20" fill="hsl(var(--map-aisle))" stroke="hsl(var(--foreground) / 0.55)" strokeWidth="1.5" />

    <rect x="180" y="220" width="40" height="250" fill="hsl(var(--map-aisle))" />
    <use href="#datacenter-rack-col" x="150" y="220" />
    <use href="#datacenter-rack-col" x="220" y="220" />

    <rect x="330" y="220" width="40" height="250" fill="hsl(var(--map-struct) / 0.6)" />
    <rect x="325" y="470" width="50" height="20" fill="hsl(var(--map-struct) / 0.6)" stroke="hsl(var(--foreground) / 0.45)" strokeWidth="1.5" />
    <use href="#datacenter-rack-col" x="300" y="220" />
    <use href="#datacenter-rack-col" x="370" y="220" />

    <rect x="480" y="220" width="40" height="250" fill="hsl(var(--map-aisle))" />
    <use href="#datacenter-rack-col" x="450" y="220" />
    <use href="#datacenter-rack-col" x="520" y="220" />

    <rect x="630" y="220" width="40" height="250" fill="hsl(var(--map-struct) / 0.6)" />
    <rect x="625" y="470" width="50" height="20" fill="hsl(var(--map-struct) / 0.6)" stroke="hsl(var(--foreground) / 0.45)" strokeWidth="1.5" />
    <use href="#datacenter-rack-col" x="600" y="220" />
    <use href="#datacenter-rack-col" x="670" y="220" />

    <rect x="780" y="220" width="40" height="250" fill="hsl(var(--map-aisle))" />
    <use href="#datacenter-rack-col" x="750" y="220" />
    <use href="#datacenter-rack-col" x="820" y="220" />

    <rect x="930" y="220" width="40" height="250" fill="hsl(var(--map-struct) / 0.6)" />
    <rect x="925" y="470" width="50" height="20" fill="hsl(var(--map-struct) / 0.6)" stroke="hsl(var(--foreground) / 0.45)" strokeWidth="1.5" />
    <use href="#datacenter-rack-col" x="900" y="220" />
    <use href="#datacenter-rack-col" x="970" y="220" />

    <path
      d="M 300 90 L 1150 90 L 1150 125 L 965 125 L 965 180 L 935 180 L 935 125 L 665 125 L 665 180 L 635 180 L 635 125 L 365 125 L 365 180 L 335 180 L 335 125 L 300 125 Z"
      fill="hsl(var(--map-struct) / 0.5)"
      stroke="hsl(var(--foreground) / 0.6)"
      strokeWidth="1.5"
    />
    <polygon points="335,180 365,180 375,195 325,195" fill="hsl(var(--map-struct) / 0.5)" stroke="hsl(var(--foreground) / 0.6)" strokeWidth="1.5" />
    <polygon points="635,180 665,180 675,195 625,195" fill="hsl(var(--map-struct) / 0.5)" stroke="hsl(var(--foreground) / 0.6)" strokeWidth="1.5" />
    <polygon points="935,180 965,180 975,195 925,195" fill="hsl(var(--map-struct) / 0.5)" stroke="hsl(var(--foreground) / 0.6)" strokeWidth="1.5" />
    <polygon points="1150,90 1150,125 1170,135 1170,80" fill="hsl(var(--map-struct) / 0.5)" stroke="hsl(var(--foreground) / 0.6)" strokeWidth="1.5" />

    <rect x="335" y="145" width="30" height="20" fill="none" stroke="hsl(var(--foreground) / 0.7)" strokeWidth="1.5" />
    <rect x="635" y="145" width="30" height="20" fill="none" stroke="hsl(var(--foreground) / 0.7)" strokeWidth="1.5" />
    <rect x="935" y="145" width="30" height="20" fill="none" stroke="hsl(var(--foreground) / 0.7)" strokeWidth="1.5" />
    <rect x="1080" y="90" width="20" height="35" fill="none" stroke="hsl(var(--foreground) / 0.7)" strokeWidth="1.5" />

    <path
      d="M 100 550 L 185 550 L 185 490 L 215 490 L 215 550 L 485 550 L 485 490 L 515 490 L 515 550 L 785 550 L 785 490 L 815 490 L 815 550 L 840 550 L 840 585 L 20 585 L 20 550 Z"
      fill="hsl(var(--map-struct) / 0.5)"
      stroke="hsl(var(--foreground) / 0.6)"
      strokeWidth="1.5"
    />
    <polygon points="20,550 20,585 10,595 10,540" fill="hsl(var(--map-struct) / 0.5)" stroke="hsl(var(--foreground) / 0.6)" strokeWidth="1.5" />

    <rect x="185" y="510" width="30" height="20" fill="none" stroke="hsl(var(--foreground) / 0.7)" strokeWidth="1.5" />
    <rect x="485" y="510" width="30" height="20" fill="none" stroke="hsl(var(--foreground) / 0.7)" strokeWidth="1.5" />
    <rect x="785" y="510" width="30" height="20" fill="none" stroke="hsl(var(--foreground) / 0.7)" strokeWidth="1.5" />
    <rect x="60" y="550" width="20" height="35" fill="none" stroke="hsl(var(--foreground) / 0.7)" strokeWidth="1.5" />

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
  onDeviceHover,
  onDeviceHoverEnd,
  selectedDeviceId,
}: DatacenterMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [simulationStep, setSimulationStep] = useState<number | null>(null);
  const [simulationResult, setSimulationResult] = useState<SimulationRunResponse | null>(null);
  const [isPlaybackRunning, setIsPlaybackRunning] = useState(false);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const [showSimulationDebug, setShowSimulationDebug] = useState(true);
  const simulationMutation = useSimulationRun();

  const simulationTotalSteps = simulationResult?.timeline.timesSeconds.length ?? 0;
  const simulationMaxIndex = Math.max(0, simulationTotalSteps - 1);
  const simulationProgress = simulationStep === null || simulationMaxIndex === 0 ? 0 : clamp01(simulationStep / simulationMaxIndex);
  const simulationActive = simulationStep !== null;
  const simulationPercent = Math.round(simulationProgress * 100);

  useEffect(() => {
    if (!isPlaybackRunning || !simulationResult || simulationTotalSteps <= 1) {
      return;
    }

    const timer = window.setInterval(() => {
      setSimulationStep((current) => {
        if (current === null) {
          return 0;
        }
        if (current >= simulationMaxIndex) {
          window.clearInterval(timer);
          setIsPlaybackRunning(false);
          return simulationMaxIndex;
        }
        return current + 1;
      });
    }, SIMULATION_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [isPlaybackRunning, simulationResult, simulationTotalSteps, simulationMaxIndex]);

  const displayNodePositions = useMemo(() => {
    if (!simulationActive || !simulationResult || simulationStep === null) {
      return nodePositions;
    }

    const timeline = simulationResult.timeline.nodePositionsTimeline;
    if (timeline.length === 0) {
      return nodePositions;
    }
    const stepNodePositions = timeline[Math.min(simulationStep, timeline.length - 1)] ?? {};
    const warmupBlend = smoothStep(0, PLAYBACK_WARMUP_STEPS, simulationStep + 1);
    const blended: Record<string, number> = { ...nodePositions };
    for (const [nodeId, targetValue] of Object.entries(stepNodePositions)) {
      blended[nodeId] = lerp(nodePositions[nodeId] ?? targetValue, targetValue, warmupBlend);
    }
    return blended;
  }, [nodePositions, simulationActive, simulationResult, simulationStep]);

  const displayDevices = devices;

  const baselineRowTemperatures = useMemo<Record<RowId, number>>(() => {
    if (!simulationResult?.timeline?.rowTemperatures) {
      return defaultBaselineRowTemperatures;
    }
    const rowTimeline = simulationResult.timeline.rowTemperatures;
    return {
      row_a: timelineAt(rowTimeline.row_a, 0, defaultBaselineRowTemperatures.row_a),
      row_b: timelineAt(rowTimeline.row_b, 0, defaultBaselineRowTemperatures.row_b),
      row_c: timelineAt(rowTimeline.row_c, 0, defaultBaselineRowTemperatures.row_c),
      row_d: timelineAt(rowTimeline.row_d, 0, defaultBaselineRowTemperatures.row_d),
      row_e: timelineAt(rowTimeline.row_e, 0, defaultBaselineRowTemperatures.row_e),
      row_f: timelineAt(rowTimeline.row_f, 0, defaultBaselineRowTemperatures.row_f),
    };
  }, [simulationResult]);

  const rowTemperatures = useMemo(() => {
    if (!simulationActive || !simulationResult || simulationStep === null) {
      return buildRowTemperatures(0);
    }

    const rowTimeline = simulationResult.timeline.rowTemperatures;
    if (!rowTimeline || Object.keys(rowTimeline).length === 0) {
      return buildRowTemperatures(simulationProgress);
    }

    const warmupBlend = smoothStep(0, PLAYBACK_WARMUP_STEPS, simulationStep + 1);
    const target = {
      row_a: timelineAt(rowTimeline.row_a, simulationStep, baselineRowTemperatures.row_a),
      row_b: timelineAt(rowTimeline.row_b, simulationStep, baselineRowTemperatures.row_b),
      row_c: timelineAt(rowTimeline.row_c, simulationStep, baselineRowTemperatures.row_c),
      row_d: timelineAt(rowTimeline.row_d, simulationStep, baselineRowTemperatures.row_d),
      row_e: timelineAt(rowTimeline.row_e, simulationStep, baselineRowTemperatures.row_e),
      row_f: timelineAt(rowTimeline.row_f, simulationStep, baselineRowTemperatures.row_f),
    };

    return {
      row_a: lerp(baselineRowTemperatures.row_a, target.row_a, warmupBlend),
      row_b: lerp(baselineRowTemperatures.row_b, target.row_b, warmupBlend),
      row_c: lerp(baselineRowTemperatures.row_c, target.row_c, warmupBlend),
      row_d: lerp(baselineRowTemperatures.row_d, target.row_d, warmupBlend),
      row_e: lerp(baselineRowTemperatures.row_e, target.row_e, warmupBlend),
      row_f: lerp(baselineRowTemperatures.row_f, target.row_f, warmupBlend),
    };
  }, [simulationActive, simulationResult, simulationStep, simulationProgress, baselineRowTemperatures]);

  const crossZoneRiseC = Math.max(
    rowTemperatures.row_b - baselineRowTemperatures.row_b,
    rowTemperatures.row_d - baselineRowTemperatures.row_d,
  );
  const localRiseC = rowTemperatures.row_f - baselineRowTemperatures.row_f;

  const currentRecirculationByZone = useMemo(() => {
    if (!simulationResult || simulationStep === null) {
      return null;
    }
    const recirc = simulationResult.timeline.zoneRecirculation;
    if (!recirc) {
      return null;
    }
    return {
      zone_ab: timelineAt(recirc.zone_ab, simulationStep, 0),
      zone_cd: timelineAt(recirc.zone_cd, simulationStep, 0),
      zone_ef: timelineAt(recirc.zone_ef, simulationStep, 0),
    };
  }, [simulationResult, simulationStep]);

  const hottestRack = useMemo(() => {
    if (!simulationResult || simulationStep === null || !simulationResult.timeline.rackCpuTemperatures) {
      return null;
    }
    let hottestRackId: string | null = null;
    let hottestTemp = -Infinity;
    for (const [rackId, series] of Object.entries(simulationResult.timeline.rackCpuTemperatures)) {
      const value = timelineAt(series, simulationStep, -Infinity);
      if (value > hottestTemp) {
        hottestTemp = value;
        hottestRackId = rackId;
      }
    }
    if (!hottestRackId) {
      return null;
    }
    return {
      rackId: hottestRackId,
      tempC: hottestTemp,
    };
  }, [simulationResult, simulationStep]);

  const serviceRiskPercent = simulationResult
    ? Math.round((simulationResult.bayesian.summary.service_degradation_probability ?? 0) * 100)
    : 0;
  const serviceBaselinePercent = simulationResult
    ? Math.round((simulationResult.bayesian.summary.baseline_service_degradation_probability ?? 0) * 100)
    : 0;
  const serviceDeltaPercent = simulationResult
    ? Math.round((simulationResult.bayesian.summary.service_probability_delta ?? 0) * 100)
    : 0;
  const cpuRiskPercent = simulationResult
    ? Math.round((simulationResult.bayesian.summary.cpu_throttling_probability ?? 0) * 100)
    : 0;
  const cpuBaselinePercent = simulationResult
    ? Math.round((simulationResult.bayesian.summary.baseline_cpu_throttling_probability ?? 0) * 100)
    : 0;
  const cpuDeltaPercent = simulationResult
    ? Math.round((simulationResult.bayesian.summary.cpu_probability_delta ?? 0) * 100)
    : 0;
  const bayesianDrivers = simulationResult?.bayesian.summary.key_drivers ?? [];
  const bayesianExplainability = simulationResult?.bayesian.explainability ?? null;
  const serviceExplain = bayesianExplainability?.serviceRisk;
  const cpuExplain = bayesianExplainability?.cpuRisk;
  const discoveryClaim = simulationResult?.discovery.discoveryClaim ?? null;
  const counterintuitiveFinding = simulationResult?.discovery.counterintuitiveFinding ?? null;
  const significanceScore = simulationResult?.discovery.significanceScore ?? null;
  const discoveryEvidence = simulationResult?.discovery.evidence ?? [];

  const startSimulation = async () => {
    setSimulationError(null);
    setIsPlaybackRunning(false);
    try {
      const result = await simulationMutation.mutateAsync({
        durationSeconds: SIMULATION_DURATION_SECONDS,
        dtSeconds: 1,
        failures: buildSimulationFailures(devices),
      });
      setSimulationResult(result);
      setSimulationStep(0);
      setIsPlaybackRunning(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Simulation failed';
      setSimulationError(message);
    }
  };

  const resetSimulation = () => {
    setIsPlaybackRunning(false);
    setSimulationStep(null);
    setSimulationResult(null);
    setSimulationError(null);
  };

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
        setTransform((current) => clampTransform(current.x, current.y, current.scale * Math.pow(2, -dy / 300)));
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
  const runSimulationLabel = simulationMutation.isPending
    ? 'Running backend simulation'
    : isPlaybackRunning
      ? `Simulation playing at ${simulationPercent}%`
      : simulationStep === null
        ? 'Run simulation'
        : 'Run simulation again';
  const simulationDebugLabel = showSimulationDebug ? 'Hide simulation debug' : 'Show simulation debug';

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <PageHeader
        title="Datacenter Overview"
        actions={
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  onClick={startSimulation}
                  disabled={simulationMutation.isPending}
                  aria-label={runSimulationLabel}
                  title={runSimulationLabel}
                >
                  {simulationMutation.isPending ? <LoaderCircle className="animate-spin" /> : <Play size={16} />}
                  <span className="sr-only">{runSimulationLabel}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-[12px] font-display">
                {runSimulationLabel}
              </TooltipContent>
            </Tooltip>
            {simulationStep !== null && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant={showSimulationDebug ? 'secondary' : 'outline'}
                      onClick={() => setShowSimulationDebug((current) => !current)}
                      aria-label={simulationDebugLabel}
                      aria-pressed={showSimulationDebug}
                      title={simulationDebugLabel}
                    >
                      <Bug size={16} />
                      <span className="sr-only">{simulationDebugLabel}</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-[12px] font-display">
                    {simulationDebugLabel}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={resetSimulation}
                      aria-label="Reset simulation"
                      title="Reset simulation"
                    >
                      <RotateCcw size={16} />
                      <span className="sr-only">Reset simulation</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-[12px] font-display">
                    Reset simulation
                  </TooltipContent>
                </Tooltip>
              </>
            )}
          </>
        }
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15, ease: [0.2, 0, 0, 1] }}
          className="overflow-hidden flex-1 relative touch-none bg-transparent"
          ref={containerRef}
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        >
          <div className="absolute top-6 right-6 z-10 flex flex-col gap-1">
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

          {simulationStep === null && (
            <div className="absolute top-6 left-6 z-10 text-[10px] text-muted-foreground font-display bg-card/90 px-2 py-1 border border-border rounded-md shadow-sm">
              Rows A-F · {devices.length} devices
            </div>
          )}

          {simulationStep !== null && showSimulationDebug && (
            <div className="absolute top-6 left-6 z-10 w-[350px] max-w-[calc(100%-120px)] bg-card/95 border border-border rounded-md px-3 py-2 shadow-sm">
              <div className="flex items-center justify-between gap-3 text-[11px] font-display">
                <span>Backend Multiphysics + Bayesian Simulation</span>
                <span className="text-muted-foreground">{simulationPercent}%</span>
              </div>
              <div className="mt-1.5 h-1.5 bg-muted rounded-sm overflow-hidden">
                <div
                  className="h-full bg-[hsl(var(--status-fault))] transition-[width] duration-75"
                  style={{ width: `${simulationPercent}%` }}
                />
              </div>
              <div className="mt-2 text-[10px] text-muted-foreground leading-tight">
                Thermal signal: local Row F hot aisle +{localRiseC.toFixed(1)}C and cross-zone hot aisle rise +{crossZoneRiseC.toFixed(1)}C.
              </div>
              {simulationResult && (
                <>
                  {discoveryClaim && (
                    <div className="mt-1 text-[10px] leading-tight text-foreground/90">
                      Discovery claim: {discoveryClaim}
                    </div>
                  )}
                  {counterintuitiveFinding && (
                    <div className="mt-1 text-[10px] leading-tight text-[hsl(var(--status-warning))]">
                      Counterintuitive: {counterintuitiveFinding}
                    </div>
                  )}
                  {typeof significanceScore === 'number' && (
                    <div className="mt-1 text-[10px] text-muted-foreground leading-tight">
                      Significance score: {significanceScore.toFixed(1)} / 100
                      {typeof simulationResult.discovery.pValue === 'number' && (
                        <span>{` · p=${simulationResult.discovery.pValue.toFixed(4)}`}</span>
                      )}
                      {typeof simulationResult.discovery.effectSize === 'number' && (
                        <span>{` · effect=${simulationResult.discovery.effectSize.toFixed(2)}`}</span>
                      )}
                    </div>
                  )}
                  <div className="mt-1 text-[10px] text-muted-foreground leading-tight">
                    Bayesian impact: service risk {serviceBaselinePercent}% to {serviceRiskPercent}% ({serviceDeltaPercent >= 0 ? '+' : ''}{serviceDeltaPercent}pp),
                    CPU throttling risk {cpuBaselinePercent}% to {cpuRiskPercent}% ({cpuDeltaPercent >= 0 ? '+' : ''}{cpuDeltaPercent}pp).
                  </div>
                  {serviceExplain && (
                    <div className="mt-1 text-[10px] text-muted-foreground leading-tight">
                      Why service risk changed: {serviceExplain.interpretation}
                    </div>
                  )}
                  {serviceExplain?.topContributors?.[0] && (
                    <div className="mt-1 text-[10px] text-muted-foreground leading-tight">
                      Top contributor: {serviceExplain.topContributors[0].sourceLabel} (
                      {Math.round(serviceExplain.topContributors[0].baselineContribution * 100)}% to {Math.round(serviceExplain.topContributors[0].candidateContribution * 100)}% weighted influence).
                    </div>
                  )}
                  {serviceExplain?.strongestPaths?.[0] && (
                    <div className="mt-1 text-[10px] text-muted-foreground leading-tight">
                      Strongest path: {serviceExplain.strongestPaths[0].path} (score {serviceExplain.strongestPaths[0].score.toFixed(2)}).
                    </div>
                  )}
                  {cpuExplain?.strongestPaths?.[0] && (
                    <div className="mt-1 text-[10px] text-muted-foreground leading-tight">
                      CPU path support: {cpuExplain.strongestPaths[0].path} (score {cpuExplain.strongestPaths[0].score.toFixed(2)}).
                    </div>
                  )}
                  <div className="mt-1 text-[10px] text-muted-foreground leading-tight">
                    Most at-risk zone: {simulationResult.bayesian.summary.most_at_risk_zone.replace('_', ' ')}.
                  </div>
                  {currentRecirculationByZone && (
                    <div className="mt-1 text-[10px] text-muted-foreground leading-tight">
                      Recirculation now: AB {(currentRecirculationByZone.zone_ab * 100).toFixed(1)}%, CD {(currentRecirculationByZone.zone_cd * 100).toFixed(1)}%, EF {(currentRecirculationByZone.zone_ef * 100).toFixed(1)}%.
                    </div>
                  )}
                  {hottestRack && (
                    <div className="mt-1 text-[10px] text-muted-foreground leading-tight">
                      Hottest rack now: {hottestRack.rackId} at {hottestRack.tempC.toFixed(1)}C.
                    </div>
                  )}
                  {discoveryEvidence.length > 0 && (
                    <div className="mt-1 text-[10px] text-muted-foreground leading-tight">
                      Evidence: {counterintuitiveFinding ? (discoveryEvidence[1] ?? discoveryEvidence[0]) : discoveryEvidence[0]}
                    </div>
                  )}
                  {bayesianDrivers.length > 0 && (
                    <div className="mt-1 text-[10px] text-muted-foreground leading-tight">
                      Key drivers: {bayesianDrivers.join(', ')}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {simulationError && (
            <div className="absolute top-6 left-6 z-10 max-w-[calc(100%-120px)] bg-card/95 border border-status-fault rounded-md px-3 py-2 shadow-sm text-[11px]">
              <span className="text-status-fault font-display">Simulation failed:</span>{' '}
              <span className="text-muted-foreground">{simulationError}</span>
            </div>
          )}

          <div className="absolute bottom-6 left-6 z-10 text-[10px] text-muted-foreground font-display bg-card/90 px-2 py-1 border border-border rounded-md shadow-sm">
            {Math.round(transform.scale * 100)}%{simulationActive ? ' · simulation' : ''}
          </div>

          <div className="absolute bottom-6 right-6 z-10 flex items-center gap-3 text-[10px] text-muted-foreground bg-card px-3 py-1.5 border border-border rounded-md shadow-sm">
            {['healthy', 'warning', 'fault'].map((status) => (
              <span key={status} className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: `hsl(${statusColor[status]})` }} />
                <span className="capitalize">{status}</span>
              </span>
            ))}
            <span className="border-l border-border pl-3 flex items-center gap-1">
              <svg width={14} height={14} viewBox="-7 -7 14 14">
                <DeviceIconSVG color="currentColor" />
              </svg>
              <span>Vent</span>
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
            {simulationStep !== null && (
              <ThermalOverlay
                rowTemperatures={rowTemperatures}
                baselineTemperatures={baselineRowTemperatures}
              />
            )}
            <DuctAirflow devices={displayDevices} nodePositions={displayNodePositions} />
            <ThermodynamicAirflow
              devices={displayDevices}
              nodePositions={displayNodePositions}
              rowTemperatures={rowTemperatures}
            />
            {displayDevices.map((device) => (
              <DeviceNode
                key={device.id}
                device={device}
                selected={device.id === selectedDeviceId}
                onClick={() => onDeviceSelect(device)}
                onMouseEnter={() => onDeviceHover?.(device)}
                onMouseLeave={() => onDeviceHoverEnd?.()}
              />
            ))}
          </svg>
        </motion.div>
      </div>
    </div>
  );
}
