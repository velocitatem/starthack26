import { useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import FacilityMap from '@/components/FacilityMap';
import DeviceDetailPanel from '@/components/DeviceDetailPanel';
import AlertDashboard from '@/components/AlertDashboard';
import AgentPanel from '@/components/AgentPanel';
import { useFacilityData } from '@/hooks/useFacilityData';

export default function Index() {
  const [activeView, setActiveView] = useState<'map' | 'alerts' | 'agent'>('map');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { ahuUnits, buildingStats, devices, error, isLoading, isError, nodePositions } = useFacilityData();
  const selectedDevice = devices.find(device => device.id === selectedDeviceId) ?? null;

  const handleDeviceSelect = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setActiveView('map');
  };

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <div className="font-display text-sm tracking-tight">Loading facility status...</div>
      </div>
    );
  }

  if (isError || !buildingStats) {
    return (
      <div className="flex h-screen items-center justify-center bg-background p-6 text-center">
        <div className="max-w-md border border-border bg-card p-6">
          <div className="font-display text-sm tracking-tight text-status-fault">Backend connection required</div>
          <div className="mt-2 text-[13px] text-muted-foreground">
            The frontend now depends on <code>/api/status</code>. Start the FastAPI backend and refresh the page.
          </div>
          {error instanceof Error ? (
            <div className="mt-3 text-[12px] text-muted-foreground">{error.message}</div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar
        activeView={activeView}
        onViewChange={setActiveView}
        buildingStats={buildingStats}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(c => !c)}
      />

      <div className="relative flex flex-1 overflow-hidden">
        {activeView === 'map' && (
          <FacilityMap
            ahuUnits={ahuUnits}
            devices={devices}
            nodePositions={nodePositions}
            onDeviceSelect={(device) => setSelectedDeviceId(device.id)}
            selectedDeviceId={selectedDeviceId}
          />
        )}
        {activeView === 'alerts' && (
          <AlertDashboard devices={devices} onNavigateToDevice={(device) => handleDeviceSelect(device.id)} />
        )}
        {activeView === 'agent' && <AgentPanel devices={devices} />}

        {activeView === 'map' && (
          <DeviceDetailPanel device={selectedDevice} onClose={() => setSelectedDeviceId(null)} />
        )}
      </div>

      <div className="fixed top-0 left-0 right-0 h-0.5 z-50 bg-brand" />
    </div>
  );
}
