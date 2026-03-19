import { useEffect, useRef } from 'react';
import { useParams, useOutletContext, Link } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import {
  Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbSeparator, BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import { type FacilityContext } from '@/types/facility';
import { useResolveFault } from '@/hooks/useFacilityData';
import { useNodeFaultHistory } from '@/hooks/useNodeFaultHistory';
import { useMlFailureMode } from '@/hooks/useMlFailureMode';
import DeviceDashboard from '@/components/DeviceDashboardV3';

export default function DeviceDashboardPage() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const { devices, historyByNodeId } = useOutletContext<FacilityContext>();
  const device = devices.find(d => d.id === deviceId);

  const { mutate: resolve, pendingFaultId } = useResolveFault();
  const historyQuery = useNodeFaultHistory(deviceId ?? null, 25);
  const {
    mutate: runMlDiagnosis, data: mlDiagnosis, isPending: isMlPending,
    error: mlError, reset: resetMlDiagnosis,
  } = useMlFailureMode();

  const lastMlNodeIdRef = useRef<string | null>(null);
  const hasActiveFaults = Boolean(device?.faults.length);

  useEffect(() => {
    if (!deviceId) { lastMlNodeIdRef.current = null; resetMlDiagnosis(); return; }
    if (!hasActiveFaults) { lastMlNodeIdRef.current = null; resetMlDiagnosis(); return; }
    if (lastMlNodeIdRef.current === deviceId) return;
    lastMlNodeIdRef.current = deviceId;
    resetMlDiagnosis();
    runMlDiagnosis(deviceId);
  }, [deviceId, hasActiveFaults, resetMlDiagnosis, runMlDiagnosis]);

  const rerunMl = () => {
    if (!deviceId) return;
    lastMlNodeIdRef.current = deviceId;
    resetMlDiagnosis();
    runMlDiagnosis(deviceId);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <PageHeader
        title={
          <Breadcrumb>
            <BreadcrumbList className="text-base font-display tracking-tight">
              <BreadcrumbItem>
                <BreadcrumbLink asChild><Link to="/issues">Issues</Link></BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{device?.name ?? deviceId ?? 'Unknown'}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
      />

      <div className="px-6 pt-6 pb-3">
        <h2 className="font-display text-lg tracking-tight">{device?.name ?? deviceId ?? 'Unknown Device'}</h2>
        {device && <p className="text-[11px] text-muted-foreground mt-0.5">{device.id} · {device.type} · {device.zone}</p>}
      </div>

      <div className="flex-1 p-6 overflow-y-auto">
        {device ? (
          <DeviceDashboard
            device={device}
            devices={devices}
            historyByNodeId={historyByNodeId}
            mlDiagnosis={mlDiagnosis}
            isMlPending={isMlPending}
            mlError={mlError}
            historyQuery={historyQuery}
            pendingFaultId={pendingFaultId}
            resolve={resolve}
            rerunMl={rerunMl}
          />
        ) : (
          <div className="text-[13px] text-muted-foreground">No device found with ID <code>{deviceId}</code>.</div>
        )}
      </div>
    </div>
  );
}
