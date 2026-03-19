import { useParams, useOutletContext, Link } from 'react-router-dom';
import DeviceTelemetry from '@/components/TelemetryCharts';
import PageHeader from '@/components/PageHeader';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import { type FacilityContext } from '@/types/facility';

export default function DeviceDashboardPage() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const { devices, historyByNodeId } = useOutletContext<FacilityContext>();
  const device = devices.find(d => d.id === deviceId);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <PageHeader
        title={
          <Breadcrumb>
            <BreadcrumbList className="text-base font-display tracking-tight">
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to="/issues">Issues</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{device?.name ?? deviceId ?? 'Unknown'}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
      />
      <div className="px-6 pb-3">
        <h2 className="font-display text-lg tracking-tight">{device?.name ?? deviceId ?? 'Unknown Device'}</h2>
        {device && <p className="text-[11px] text-muted-foreground mt-0.5">{device.id} · {device.type} · {device.zone}</p>}
      </div>
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
