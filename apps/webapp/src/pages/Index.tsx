import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import AppSidebar from '@/components/AppSidebar';
import { useFacilityData } from '@/hooks/useFacilityData';
import { type FacilityContext } from '@/types/facility';

export default function Layout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const location = useLocation();
  const { ahuUnits, buildingStats, devices, error, historyByNodeId, isLoading, isError, nodePositions } = useFacilityData();

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

  const activeView = location.pathname.startsWith('/issues') ? 'issues'
    : location.pathname.startsWith('/agent') ? 'agent'
    : 'map';

  const ctx: FacilityContext = { ahuUnits, buildingStats, devices, historyByNodeId, nodePositions };

  return (
    <div className="flex h-screen overflow-hidden">
      <div className="fixed top-0 left-0 right-0 h-0.5 z-50 bg-brand" />
      <AppSidebar
        activeView={activeView}
        buildingStats={buildingStats}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(c => !c)}
      />
      <div className="relative flex flex-1 overflow-hidden">
        <Outlet context={ctx} />
      </div>
    </div>
  );
}
