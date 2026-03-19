import { useState } from 'react';
import { type Device, type Fault } from '@/data/mockDevices';
import { ChevronRight, Zap } from 'lucide-react';

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
  medium: 'bg-muted text-muted-foreground border-border',
  low: 'bg-muted text-muted-foreground border-border',
};

export default function AlertDashboard({ devices, onNavigateToDevice }: AlertDashboardProps) {
  const [severityFilter, setSeverityFilter] = useState<string | null>(null);

  const alerts: AlertItem[] = devices
    .flatMap(device => device.faults.map(fault => ({ device, fault })))
    .sort((a, b) => severityOrder[a.fault.severity] - severityOrder[b.fault.severity]);

  const filtered = severityFilter ? alerts.filter(a => a.fault.severity === severityFilter) : alerts;
  const totalEnergyWaste = `${alerts.reduce((sum, alert) => sum + parseEnergyWaste(alert.fault.energyWaste), 0).toLocaleString()} kWh/day`;

  return (
    <div className="flex-1 p-6 overflow-y-auto">
      <div className="mb-6">
        <h1 className="font-display text-lg tracking-tight">Alert Dashboard</h1>
        <p className="text-[13px] text-muted-foreground mt-0.5">{alerts.length} active faults across {new Set(alerts.map(a => a.device.id)).size} devices</p>
      </div>

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

      {/* Alert list */}
      <div className="border border-border bg-card">
        <div className="data-row border-b border-border data-row-header">
          <span className="label-caps flex-1">Fault</span>
          <span className="label-caps w-28">Device</span>
          <span className="label-caps w-28">Zone</span>
          <span className="label-caps w-24">Impact</span>
          <span className="label-caps w-20">Severity</span>
          <span className="w-8" />
        </div>

        {filtered.map(alert => (
          <div
            key={alert.fault.id}
            className="data-row cursor-pointer group"
            onClick={() => onNavigateToDevice(alert.device)}
          >
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium truncate">{alert.fault.type}</div>
              <div className="text-[11px] text-muted-foreground truncate">{alert.fault.diagnosis.slice(0, 80)}…</div>
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
            <div className="w-8 flex justify-end">
              <ChevronRight size={14} className="text-muted-foreground group-hover:text-foreground transition-colors" />
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="py-12 text-center text-[13px] text-muted-foreground">
            No faults match the current filter.
          </div>
        )}
      </div>
    </div>
  );
}
