import { useState } from 'react';
import { type Device, type Fault } from '@/types/facility';
import { useResolveFault } from '@/hooks/useFacilityData';
import { Zap, Check, Loader2 } from 'lucide-react';
import PageHeader from '@/components/PageHeader';

interface AlertDashboardProps {
  devices: Device[];
  onNavigateToDevice: (device: Device) => void;
}

interface AlertItem {
  device: Device;
  fault: Fault;
}

const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const parseEnergyWaste = (value: string) => {
  const match = value.match(/([\d,.]+)/);
  return match ? Number(match[1].replace(/,/g, '')) : 0;
};

const severityBadge: Record<string, string> = {
  critical: 'bg-status-fault/15 text-status-fault border-status-fault/30',
  high: 'bg-status-warning/15 text-status-warning border-status-warning/30',
  medium: 'bg-status-warning/15 text-status-warning border-status-warning/30',
  low: 'bg-muted text-muted-foreground border-border',
};

export default function AlertDashboard({ devices, onNavigateToDevice }: AlertDashboardProps) {
  const [severityFilter, setSeverityFilter] = useState<string | null>(null);
  const [deviceFilter, setDeviceFilter] = useState<string | null>(null);
  const { mutate: resolve, pendingFaultId } = useResolveFault();

  const alerts: AlertItem[] = devices
    .flatMap(device => device.faults.map(fault => ({ device, fault })))
    .sort((a, b) => severityOrder[a.fault.severity] - severityOrder[b.fault.severity]);

  const uniqueDeviceIds = [...new Set(devices.map(d => d.id))].sort();
  const filtered = alerts
    .filter(a => !severityFilter || a.fault.severity === severityFilter)
    .filter(a => !deviceFilter || a.device.id === deviceFilter);
  const totalEnergyWaste = `${alerts.reduce((sum, alert) => sum + parseEnergyWaste(alert.fault.energyWaste), 0).toLocaleString()} kWh/day`;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <PageHeader title="Issues" />
      <div className="flex-1 p-6 overflow-y-auto">

      {/* Summary bar */}
      <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Critical', count: alerts.filter(a => a.fault.severity === 'critical').length, color: 'border-status-fault/30', text: 'text-status-fault' },
            { label: 'High', count: alerts.filter(a => a.fault.severity === 'high').length, color: 'border-status-warning/30', text: 'text-status-warning' },
            { label: 'Medium', count: alerts.filter(a => a.fault.severity === 'medium').length, color: 'border-border', text: 'text-muted-foreground' },
            { label: 'Total Energy Waste', count: totalEnergyWaste, color: 'border-border', text: 'text-foreground', wide: true },
          ].map(s => (
          <div
            key={s.label}
            className={`border bg-card p-4 cursor-pointer shadow-sm hover:shadow-md transition-shadow ${severityFilter === s.label.toLowerCase() ? 'card-accent-top border-foreground' : s.color}`}
            onClick={() => setSeverityFilter(severityFilter === s.label.toLowerCase() ? null : s.label === 'Total Energy Waste' ? null : s.label.toLowerCase())}
          >
            <div className="label-caps">{s.label}</div>
            <div className={`font-display text-2xl mt-1 ${s.text}`}>{s.count}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 mb-6">
        <div className="label-caps shrink-0">Device</div>
        <select
          value={deviceFilter ?? ''}
          onChange={(e) => setDeviceFilter(e.target.value || null)}
          className="h-8 border border-border bg-background px-2 text-[12px] outline-none min-w-[200px]"
        >
          <option value="">All devices</option>
          {uniqueDeviceIds.map(id => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>
        {deviceFilter && (
          <button
            onClick={() => setDeviceFilter(null)}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors underline"
          >
            Clear
          </button>
        )}
      </div>

      <div className="border border-border bg-card">
        <div className="data-row border-b border-border data-row-header">
          <span className="label-caps flex-1">Fault</span>
          <span className="label-caps w-28">Device</span>
          <span className="label-caps w-28">Zone</span>
          <span className="label-caps w-24">Impact</span>
          <span className="label-caps w-20">Severity</span>
          <span className="w-20" />
        </div>

        {filtered.map(alert => {
          const isPending = pendingFaultId === alert.fault.id;
          return (
            <div
              key={alert.fault.id}
              className={`data-row cursor-pointer group ${isPending ? 'opacity-50 pointer-events-none' : ''}`}
              onClick={() => onNavigateToDevice(alert.device)}
            >
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate">{alert.fault.type}</div>
                <div className="text-[11px] text-muted-foreground truncate">{alert.fault.diagnosis.slice(0, 80)}...</div>
              </div>
              <div className="w-28 text-[12px] font-display text-secondary-foreground">{alert.device.id}</div>
              <div className="w-28 text-[12px] text-muted-foreground truncate">{alert.device.zone}</div>
              <div className="w-24">
                <div className="text-[12px] font-display text-foreground flex items-center gap-1"><Zap size={10} />{alert.fault.energyWaste}</div>
              </div>
              <div className="w-20">
                <span className={`inline-block px-2 py-0.5 text-[10px] uppercase tracking-wider font-medium border ${severityBadge[alert.fault.severity]}`}>
                  {alert.fault.severity}
                </span>
              </div>
              <div className="w-20 flex justify-end">
                <button
                  disabled={isPending}
                  onClick={(e) => { e.stopPropagation(); resolve(alert.fault.id); }}
                  className="flex items-center gap-1 text-[11px] px-2 py-1 border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isPending ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                  {isPending ? 'Resolving...' : 'Resolve'}
                </button>
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="py-12 text-center text-[13px] text-muted-foreground">
            No faults match the current filter.
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
