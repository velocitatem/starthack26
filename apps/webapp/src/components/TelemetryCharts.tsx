import { useMemo } from 'react';
import { Gauge, Move, Thermometer, Waves, Zap, Droplets, Wind, Activity, Antenna, BatteryCharging, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { type Device, type TelemetryPoint } from '@/types/facility';

const CHANNEL_COLORS: Record<string, string> = {
  torque: 'hsl(var(--brand))',
  position: 'hsl(var(--status-warning))',
  temperature: 'hsl(var(--status-healthy))',
};

const CHANNEL_ICONS: Record<string, LucideIcon> = {
  torque: Gauge,
  position: Move,
  position_percent: Move,
  temperature: Thermometer,
  setpoint_position_percent: SlidersHorizontal,
  vibration: Waves,
  current: Zap,
  power_w: Zap,
  humidity: Droplets,
  flow: Wind,
  pressure: Gauge,
  voltage: BatteryCharging,
  signal: Antenna,
};

const FALLBACK_ICONS: LucideIcon[] = [Activity, Waves, BatteryCharging, Droplets, Wind];
const getChannelIcon = (key: string): LucideIcon =>
  CHANNEL_ICONS[key] ?? FALLBACK_ICONS[Math.abs([...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % FALLBACK_ICONS.length];

const titleCase = (value: string) => value
  .split('_')
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

const formatAxisTime = (time: string) => {
  const d = new Date(time);
  return Number.isNaN(d.getTime()) ? time : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

function TelemetryChart({ channel }: { channel: { key: string; label: string; data: TelemetryPoint[]; color: string } }) {
  const chartConfig: ChartConfig = { [channel.key]: { label: channel.label, color: channel.color } };
  const chartData = channel.data.map((p) => ({ time: p.time, [channel.key]: p.value }));
  const values = channel.data.map((p) => p.value);
  const [min, max] = values.length ? [Math.min(...values), Math.max(...values)] : [0, 1];
  const pad = (max - min) * 0.1 || 1;

  return (
    <ChartContainer config={chartConfig} className="!aspect-auto h-[250px] w-full">
      <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
        <defs>
          <linearGradient id={`fill-${channel.key}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={channel.color} stopOpacity={0.25} />
            <stop offset="95%" stopColor={channel.color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="time" tickFormatter={formatAxisTime} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={40} />
        <YAxis domain={[min - pad, max + pad]} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => v.toFixed(1)} />
        <ChartTooltip
          content={<ChartTooltipContent labelFormatter={(v) => formatAxisTime(v as string)} indicator="line" />}
        />
        <Area
          type="monotone"
          dataKey={channel.key}
          stroke={channel.color}
          strokeWidth={1.5}
          fill={`url(#fill-${channel.key})`}
          dot={false}
          activeDot={{ r: 3, strokeWidth: 1 }}
        />
      </AreaChart>
    </ChartContainer>
  );
}

export default function DeviceTelemetry({
  devices,
  historyByNodeId,
  selectedNodeId,
}: {
  devices: Device[];
  historyByNodeId: Record<string, Record<string, TelemetryPoint[]>>;
  selectedNodeId: string | null;
}) {
  const selectedDevice = devices.find((d) => d.id === selectedNodeId);
  const nodeHistory = selectedNodeId ? historyByNodeId[selectedNodeId] : undefined;

  const telemetryChannels = useMemo(() => {
    if (nodeHistory) {
      return Object.entries(nodeHistory).map(([key, data]) => ({
        key,
        label: titleCase(key),
        data,
        color: CHANNEL_COLORS[key] ?? 'hsl(var(--brand))',
      }));
    }
    if (!selectedDevice) return [];
    return (['torque', 'position', 'temperature'] as const)
      .filter((k) => selectedDevice[k].length > 0)
      .map((k) => ({
        key: k,
        label: titleCase(k),
        data: selectedDevice[k],
        color: CHANNEL_COLORS[k],
      }));
  }, [nodeHistory, selectedDevice]);

  const latestValue = (data: TelemetryPoint[]) => data.length ? data[data.length - 1].value.toFixed(1) : '-';

  return (
    <div className="space-y-4">
      {selectedDevice && (
        <div className="border border-border bg-card p-3">
          <div className="flex items-center gap-3">
            <div className="text-[13px] font-medium text-foreground">{selectedDevice.name}</div>
            <span className={`px-1.5 py-0.5 text-[10px] uppercase tracking-wider font-medium ${
              selectedDevice.status === 'fault' ? 'bg-status-fault/15 text-status-fault'
                : selectedDevice.status === 'warning' ? 'bg-status-warning/15 text-status-warning'
                : 'bg-status-healthy/15 text-status-healthy'
            }`}>
              {selectedDevice.status}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {selectedDevice.type} - {selectedDevice.zone} - Deviation: {(selectedDevice.anomalyScore * 100).toFixed(0)}%
          </div>
        </div>
      )}

      {telemetryChannels.length === 0 ? (
        <div className="text-[12px] text-muted-foreground">No telemetry data available for this node.</div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {telemetryChannels.map((channel) => (
            <div key={channel.key} className="border border-border bg-card p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  {(() => { const Icon = getChannelIcon(channel.key); return <Icon size={12} className="text-muted-foreground" />; })()}
                  <span className="label-caps">{channel.label}</span>
                </div>
                <span className="font-display text-sm text-foreground">{latestValue(channel.data)}</span>
              </div>
              <TelemetryChart channel={channel} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
