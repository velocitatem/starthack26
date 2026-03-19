import { useParams, useOutletContext, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import DeviceTelemetry from '@/components/TelemetryCharts';
import PageHeader from '@/components/PageHeader';
import { type FacilityContext } from '@/types/facility';

export default function DeviceDashboardPage() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const { devices, historyByNodeId } = useOutletContext<FacilityContext>();
  const device = devices.find(d => d.id === deviceId);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <PageHeader
        title={device?.name ?? deviceId ?? 'Unknown Device'}
        subtitle={device ? `${device.id} - ${device.type} - ${device.zone}` : 'Device not found'}
        actions={
          <Link to="/issues" className="inline-flex items-center gap-1.5 border border-border px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={12} />
            Back to Issues
          </Link>
        }
      />
      <div className="flex-1 p-6 overflow-y-auto">
        {device ? (
          <DeviceTelemetry
            devices={devices}
            historyByNodeId={historyByNodeId}
            selectedNodeId={deviceId ?? null}
          />
        ) : (
          <div className="text-[13px] text-muted-foreground">
            No device found with ID <code>{deviceId}</code>.
          </div>
        )}
      </div>
    </div>
  );
}
