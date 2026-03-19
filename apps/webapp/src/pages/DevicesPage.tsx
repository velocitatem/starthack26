import { useNavigate, useOutletContext } from 'react-router-dom';
import { type FacilityContext } from '@/types/facility';
import PageHeader from '@/components/PageHeader';
import { Server } from 'lucide-react';

const statusDot: Record<string, string> = {
  healthy: 'bg-status-healthy',
  warning: 'bg-status-warning',
  fault: 'bg-status-fault',
  offline: 'bg-status-offline',
};

export default function DevicesPage() {
  const { devices } = useOutletContext<FacilityContext>();
  const navigate = useNavigate();

  const sorted = [...devices].sort((a, b) => {
    const order: Record<string, number> = { fault: 0, warning: 1, offline: 2, healthy: 3 };
    return (order[a.status] ?? 4) - (order[b.status] ?? 4);
  });

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <PageHeader title="Devices" />
      <div className="flex-1 p-6 overflow-y-auto">

        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Total', value: devices.length, color: 'text-foreground' },
            { label: 'Healthy', value: devices.filter(d => d.status === 'healthy').length, color: 'text-status-healthy' },
            { label: 'Warning', value: devices.filter(d => d.status === 'warning').length, color: 'text-status-warning' },
            { label: 'Fault', value: devices.filter(d => d.status === 'fault').length, color: 'text-status-fault' },
          ].map(s => (
            <div key={s.label} className="border border-border bg-card p-4">
              <div className="label-caps">{s.label}</div>
              <div className={`font-display text-2xl mt-1 ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>

        <div className="border border-border bg-card">
          <div className="data-row border-b border-border data-row-header">
            <span className="label-caps w-8" />
            <span className="label-caps flex-1">Name</span>
            <span className="label-caps w-36">ID</span>
            <span className="label-caps w-28">Zone</span>
            <span className="label-caps w-24">Type</span>
            <span className="label-caps w-20">Faults</span>
            <span className="label-caps w-24">Deviation</span>
          </div>

          {sorted.map(device => (
            <div
              key={device.id}
              className="data-row cursor-pointer group"
              onClick={() => navigate(`/devices/${device.id}`)}
            >
              <div className="w-8 flex items-center">
                <span className={`h-2 w-2 rounded-full ${statusDot[device.status]}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate">{device.name}</div>
                <div className="text-[11px] text-muted-foreground">{device.model} · {device.serial}</div>
              </div>
              <div className="w-36 text-[12px] font-display text-secondary-foreground truncate">{device.id}</div>
              <div className="w-28 text-[12px] text-muted-foreground truncate">{device.zone}</div>
              <div className="w-24 text-[12px] text-muted-foreground capitalize">{device.type}</div>
              <div className="w-20">
                <span className={`font-display text-[13px] ${device.faults.length > 0 ? 'text-status-fault' : 'text-muted-foreground'}`}>
                  {device.faults.length}
                </span>
              </div>
              <div className="w-24 text-[12px] font-display">
                <span className={device.anomalyScore > 0.7 ? 'text-status-fault' : device.anomalyScore > 0.4 ? 'text-status-warning' : 'text-muted-foreground'}>
                  {Math.round(device.anomalyScore * 100)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
