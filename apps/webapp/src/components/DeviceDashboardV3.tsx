import type { UseQueryResult } from '@tanstack/react-query';
import {
  Zap, Clock, Wrench, Check, Loader2, Activity, AlertTriangle, Shield, Server,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import DeviceTelemetry from '@/components/TelemetryCharts';
import type { Device, NodeFaultHistoryResponse, TelemetryPoint } from '@/types/facility';

export interface DeviceDashboardProps {
  device: Device;
  devices: Device[];
  historyByNodeId: Record<string, Record<string, TelemetryPoint[]>>;
  historyQuery: UseQueryResult<NodeFaultHistoryResponse>;
  pendingFaultId: string | null;
  resolve: (faultId: string) => void;
}

const severityBadge: Record<string, string> = {
  critical: 'bg-status-fault/15 text-status-fault border-status-fault/30',
  high: 'bg-status-warning/15 text-status-warning border-status-warning/30',
  medium: 'bg-status-warning/15 text-status-warning border-status-warning/30',
  low: 'bg-muted text-muted-foreground border-border',
};

const titleCase = (v: string) => v.split('_').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
const fmtTs = (v: string) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export default function DeviceDashboard({
  device, devices, historyByNodeId, historyQuery, pendingFaultId, resolve,
}: DeviceDashboardProps) {
  const openFaults = historyQuery.data?.openFaults ?? device.faults.length;
  const totalFaults = historyQuery.data?.totalFaults ?? 0;
  const anomalyPct = Math.round(device.anomalyScore * 100);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${device.status === 'healthy' ? 'bg-status-healthy' : device.status === 'warning' ? 'bg-status-warning' : 'bg-status-fault'}`} />
          <span className="font-display text-sm capitalize">{device.status}</span>
        </div>
        <div className="h-4 w-px bg-border" />
        <span className="font-display text-sm">{anomalyPct}% deviation</span>
        <div className="h-4 w-px bg-border" />
        <span className="text-[12px]">{openFaults} active fault{openFaults !== 1 ? 's' : ''}</span>
        <div className="h-4 w-px bg-border" />
        <span className="text-[12px] text-muted-foreground">{totalFaults} historical</span>
        <div className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">
          <Server size={11} />{device.model} · {device.serial}
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="telemetry">Telemetry</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-5 gap-3">
            {[
              { label: 'Zone', value: device.zone },
              { label: 'Type', value: device.type, capitalize: true },
              { label: 'Installed', value: device.installedDate },
              { label: 'Deviation', value: `${anomalyPct}%` },
              { label: 'Energy Waste', value: device.faults[0]?.energyWaste ?? '--' },
            ].map(s => (
              <div key={s.label} className="border border-border bg-card px-3 py-2">
                <div className="label-caps">{s.label}</div>
                <div className={`mt-1 text-[13px] font-medium ${s.capitalize ? 'capitalize' : ''}`}>{s.value}</div>
              </div>
            ))}
          </div>

          {device.faults.length > 0 ? (
            <div className="space-y-3">
              {device.faults.map(f => {
                const pending = pendingFaultId === f.id;
                return (
                  <div key={f.id} className={`border border-border bg-card p-4 fault-card-accent ${pending ? 'opacity-50' : ''}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <AlertTriangle size={13} className="text-status-fault" />
                          <span className="text-[13px] font-medium">{f.type}</span>
                          <span className={`inline-block border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${severityBadge[f.severity]}`}>{f.severity}</span>
                        </div>
                        <div className="text-[12px] leading-relaxed text-muted-foreground">{f.diagnosis}</div>
                        <div className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                          <Wrench size={11} className="mt-0.5 shrink-0" />{f.recommendation}
                        </div>
                        <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                          <span className="flex items-center gap-1"><Zap size={10} />{f.energyWaste}</span>
                          <span className="flex items-center gap-1"><Clock size={10} />{fmtTs(f.detectedAt)}</span>
                          <span>{f.estimatedImpact}</span>
                        </div>
                      </div>
                      <button disabled={pending} onClick={() => resolve(f.id)} className="flex items-center gap-1 border border-border px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50">
                        {pending ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                        {pending ? 'Resolving...' : 'Resolve'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="border border-border bg-card p-6 text-center">
              <Shield size={20} className="mx-auto text-status-healthy mb-2" />
              <div className="font-display text-sm text-status-healthy">No Active Faults</div>
              <div className="mt-1 text-[12px] text-muted-foreground">Operating within normal parameters</div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <div className="border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="font-display text-base tracking-tight">Fault History</div>
                <div className="text-[12px] text-muted-foreground mt-0.5">{totalFaults} total incidents recorded for this device</div>
              </div>
              <div className="flex gap-3">
                {[
                  { label: 'Open', value: openFaults, color: openFaults > 0 ? 'text-status-fault' : 'text-status-healthy' },
                  { label: 'Resolved', value: totalFaults - openFaults, color: 'text-status-healthy' },
                ].map(s => (
                  <div key={s.label} className="w-20 border border-border bg-background/60 px-3 py-1.5 text-center">
                    <div className="label-caps">{s.label}</div>
                    <div className={`font-display text-lg ${s.color}`}>{s.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {historyQuery.isLoading && (
              <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-muted-foreground"><Loader2 size={12} className="animate-spin" />Loading history...</div>
            )}

            {historyQuery.data?.faultHistory.length === 0 && (
              <div className="py-8 text-center text-[12px] text-muted-foreground">No historical incidents recorded yet.</div>
            )}

            <div className="space-y-2">
              {historyQuery.data?.faultHistory.map((h, i) => (
                <div key={h.id} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className={`h-3 w-3 rounded-full shrink-0 ${h.state === 'open' ? 'bg-status-fault' : 'bg-status-healthy'}`} />
                    {i < (historyQuery.data?.faultHistory.length ?? 0) - 1 && <div className="w-px flex-1 bg-border" />}
                  </div>
                  <div className="flex-1 border border-border bg-background/60 p-3 mb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-[13px] font-medium">{titleCase(h.kind)}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{h.id}</div>
                      </div>
                      <span className={`inline-block border px-2 py-0.5 text-[10px] uppercase tracking-wider ${h.state === 'open' ? 'bg-status-fault/15 text-status-fault border-status-fault/30' : 'bg-status-healthy/15 text-status-healthy border-status-healthy/30'}`}>{h.state}</span>
                    </div>
                    <div className="mt-2 text-[12px] leading-relaxed text-foreground/90">{h.summary}</div>
                    <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><Activity size={10} />{(h.probability * 100).toFixed(0)}% likelihood</span>
                      <span className="inline-flex items-center gap-1"><Clock size={10} />{fmtTs(h.openedAt)}</span>
                    </div>
                    <div className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                      <Wrench size={11} className="mt-0.5 shrink-0" />{h.recommendedAction}
                    </div>
                    {h.state === 'resolved' && (h.resolvedBy || h.note) && (
                      <div className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
                        {h.resolvedBy && <span>Resolved by {h.resolvedBy}</span>}
                        {h.note && <span className="ml-2">{h.note}</span>}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="telemetry">
          <DeviceTelemetry devices={devices} historyByNodeId={historyByNodeId} selectedNodeId={device.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
