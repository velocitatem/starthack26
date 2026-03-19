import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Zap,
  Clock,
  Wrench,
  Check,
  Loader2,
  ChevronDown,
  Activity,
  ExternalLink,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { type Device, type NodeFaultHistoryEntry } from '@/types/facility';
import { useResolveFault } from '@/hooks/useFacilityData';
import { useNodeFaultHistory } from '@/hooks/useNodeFaultHistory';
import Sparkline from './Sparkline';

interface DeviceDetailPanelProps {
  device: Device | null;
  mode?: 'pinned' | 'peek';
  onClose: () => void;
}

const statusStyles: Record<string, string> = {
  healthy: 'text-status-healthy',
  warning: 'text-status-warning',
  critical: 'text-status-fault',
  fault: 'text-status-fault',
  offline: 'text-status-offline',
};

const severityBadge: Record<string, string> = {
  critical: 'bg-status-fault/15 text-status-fault border-status-fault/30',
  high: 'bg-status-warning/15 text-status-warning border-status-warning/30',
  medium: 'bg-status-warning/15 text-status-warning border-status-warning/30',
  low: 'bg-muted text-muted-foreground border-border',
};

const formatAnomalyConfidence = (value: number) => `${Math.round(value * 100)}%`;

const historyStateBadge: Record<NodeFaultHistoryEntry['state'], string> = {
  open: 'bg-status-fault/15 text-status-fault border-status-fault/30',
  resolved: 'bg-status-healthy/15 text-status-healthy border-status-healthy/30',
};

const titleCase = (value: string) => value
  .split('_')
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

const formatTimestamp = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export default function DeviceDetailPanel({ device, mode = 'pinned', onClose }: DeviceDetailPanelProps) {
  const isPeek = mode === 'peek';
  const { mutate: resolve, pendingFaultId } = useResolveFault();
  const historyQuery = useNodeFaultHistory(device?.id ?? null, 10);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const currentDeviceId = device?.id ?? null;

  useEffect(() => {
    setIsHistoryOpen(false);
  }, [currentDeviceId]);

  return (
    <AnimatePresence mode="wait">
      {device && (
        <motion.div
          key={`${device.id}-${mode}`}
          initial={isPeek ? { x: 360, opacity: 0 } : { width: 0, opacity: 0 }}
          animate={isPeek ? { x: 0, opacity: 1 } : { width: 360, opacity: 1 }}
          exit={isPeek ? { x: 360, opacity: 0 } : { width: 0, opacity: 0 }}
          transition={{ duration: isPeek ? 0.18 : 0.24, ease: [0.2, 0, 0, 1] }}
          className={isPeek
            ? 'absolute right-0 top-0 z-30 h-full w-[360px] border-l border-border bg-card shadow-xl pointer-events-none'
            : 'h-full shrink-0 overflow-hidden border-l border-border bg-card'
          }
        >
          <div className={isPeek ? 'w-[360px]' : 'w-[360px] h-full overflow-y-auto'}>
          <div className={`h-16 shrink-0 flex items-center justify-between border-b border-border px-5 ${isPeek ? '' : 'card-accent-top'}`}>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-display text-base tracking-tight">{device.name}</span>
                {!isPeek && (
                  <Link
                    to={`/devices/${device.id}`}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                    title="View full device details"
                  >
                    <ExternalLink size={12} />
                  </Link>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground">{device.id}</div>
            </div>
            {!isPeek && (
              <button onClick={onClose} className="p-1 text-muted-foreground transition-colors hover:text-foreground">
                <X size={16} />
              </button>
            )}
          </div>

          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${device.status === 'healthy' ? 'bg-status-healthy' : device.status === 'warning' ? 'bg-status-warning' : 'bg-status-fault'}`} />
              <span className={`text-[13px] font-medium capitalize ${statusStyles[device.status]}`}>{device.status}</span>
            </div>
            <div className="text-right">
              <div className="label-caps">Deviation from normal</div>
              <div className={`font-display text-lg ${device.anomalyScore > 0.7 ? 'text-status-fault' : device.anomalyScore > 0.4 ? 'text-status-warning' : 'text-status-healthy'}`}>
                {formatAnomalyConfidence(device.anomalyScore)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 border-b border-border px-5 py-3">
            <div className="border border-border bg-background/60 px-3 py-2">
              <div className="label-caps">Faults Recorded</div>
              <div className="mt-1 font-display text-lg">{historyQuery.data?.totalFaults ?? '--'}</div>
              <div className="text-[11px] text-muted-foreground">Historical incidents</div>
            </div>
            <div className="border border-border bg-background/60 px-3 py-2">
              <div className="label-caps">Open Faults</div>
              <div className={`mt-1 font-display text-lg ${device.faults.length > 0 ? 'text-status-fault' : 'text-status-healthy'}`}>
                {historyQuery.data?.openFaults ?? device.faults.length}
              </div>
              <div className="text-[11px] text-muted-foreground">Active on this device</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 border-b border-border px-5 py-3">
            {[
              { label: 'Zone', value: device.zone },
              { label: 'Type', value: device.type },
              { label: 'Model', value: device.model },
              { label: 'Serial', value: device.serial },
              { label: 'Installed', value: device.installedDate },
            ].map((meta) => (
              <div key={meta.label}>
                <div className="label-caps">{meta.label}</div>
                <div className="mt-0.5 text-[13px] capitalize text-secondary-foreground">{meta.value}</div>
              </div>
            ))}
          </div>

          <div className="border-b border-border px-5 py-4">
            <div className="label-caps mb-3">Live Telemetry (24h)</div>
            <div className="space-y-4">
              {[
                { label: 'Torque (Nm)', data: device.torque, color: 'hsl(var(--brand))' },
                { label: 'Position (%)', data: device.position, color: 'hsl(var(--foreground))' },
                { label: 'Temperature (°C)', data: device.temperature, color: 'hsl(var(--status-warning))' },
              ].map((telemetry) => (
                <div key={telemetry.label} className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] text-muted-foreground">{telemetry.label}</div>
                    <div className="mt-0.5 font-display text-sm">{telemetry.data[telemetry.data.length - 1]?.value.toFixed(1) ?? '--'}</div>
                  </div>
                  <Sparkline data={telemetry.data} color={telemetry.color} />
                </div>
              ))}
            </div>
          </div>

          {isPeek && (
            <div className="px-5 py-3 text-[11px] text-muted-foreground text-center border-t border-border">
              Click device to view full details
            </div>
          )}

          {!isPeek && (
            <>
              {device.faults.length > 0 && (
                <div className="border-b border-border px-5 py-4">
                  <div className="label-caps mb-3">Active Faults ({device.faults.length})</div>
                  <div className="space-y-3">
                    {device.faults.map((fault) => {
                      const isPending = pendingFaultId === fault.id;
                      return (
                        <div key={fault.id} className={`border border-border bg-card p-3 fault-card-accent ${isPending ? 'opacity-50' : ''}`}>
                          <div className="text-[13px] font-medium">{fault.type}</div>
                          <span className={`mt-1.5 inline-block border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${severityBadge[fault.severity]}`}>
                            {fault.severity}
                          </span>

                          <div className="mt-2.5 text-[12px] leading-relaxed text-muted-foreground">{fault.diagnosis}</div>

                          <div className="mt-2.5 border-t border-border pt-2">
                            <div className="mb-2 flex items-start gap-1.5">
                              <Wrench size={11} className="mt-0.5 shrink-0 text-muted-foreground" />
                              <span className="text-[11px] leading-relaxed text-muted-foreground">{fault.recommendation}</span>
                            </div>
                            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                              <div className="flex items-center gap-3">
                                <span className="flex items-center gap-1"><Zap size={10} />{fault.energyWaste}</span>
                                <span className="flex items-center gap-1"><Clock size={10} />{new Date(fault.detectedAt).toLocaleDateString()}</span>
                              </div>
                              <button
                                disabled={isPending}
                                onClick={() => resolve(fault.id)}
                                className="flex items-center gap-1 border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {isPending ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                                {isPending ? 'Resolving...' : 'Resolve'}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <Link
                    to={`/devices/${device.id}`}
                    className="mt-3 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors border border-border px-2 py-1"
                  >
                    <ExternalLink size={10} />View all fault details
                  </Link>
                </div>
              )}

              {device.faults.length === 0 && (
                <div className="border-b border-border px-5 py-8 text-center">
                  <div className="font-display text-sm text-status-healthy">No Active Faults</div>
                  <div className="mt-1 text-[12px] text-muted-foreground">Device operating within normal parameters</div>
                </div>
              )}

              <div className="border-b border-border px-5 py-4">
                <button
                  type="button"
                  onClick={() => setIsHistoryOpen((open) => !open)}
                  className="flex w-full items-center justify-between gap-3 text-left"
                >
                  <div>
                    <div className="label-caps">Fault History</div>
                    <div className="mt-1 text-[12px] text-muted-foreground">
                      {historyQuery.data ? `${historyQuery.data.totalFaults} recorded incidents for this device` : 'Open and resolved backend incidents'}
                    </div>
                  </div>
                  <ChevronDown
                    size={16}
                    className={`shrink-0 text-muted-foreground transition-transform ${isHistoryOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                {isHistoryOpen && (
                  <div className="mt-3 space-y-2">
                    {historyQuery.isLoading && (
                      <div className="inline-flex items-center gap-2 text-[12px] text-muted-foreground">
                        <Loader2 size={12} className="animate-spin" />
                        Loading history...
                      </div>
                    )}

                    {historyQuery.error instanceof Error && (
                      <div className="text-[12px] text-status-fault">
                        Could not load history ({historyQuery.error.message})
                      </div>
                    )}

                    {historyQuery.data?.faultHistory.length === 0 && (
                      <div className="text-[12px] text-muted-foreground">
                        No historical incidents recorded for this device yet.
                      </div>
                    )}

                    {historyQuery.data?.faultHistory.map((fault) => (
                      <div key={fault.id} className="border border-border bg-background/60 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-[12px] font-medium text-foreground">{titleCase(fault.kind)}</div>
                            <div className="mt-1 text-[11px] text-muted-foreground">{fault.id}</div>
                          </div>
                          <span className={`inline-block border px-2 py-0.5 text-[10px] uppercase tracking-wider ${historyStateBadge[fault.state]}`}>
                            {fault.state}
                          </span>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Activity size={11} />
                            Likelihood {(fault.probability * 100).toFixed(0)}%
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Clock size={11} />
                            Opened {formatTimestamp(fault.openedAt)}
                          </span>
                        </div>

                        <div className="mt-2 text-[12px] leading-relaxed text-foreground/90">{fault.summary}</div>
                        <div className="mt-2 inline-flex items-start gap-1 text-[11px] text-muted-foreground">
                          <Wrench size={11} className="mt-0.5 shrink-0" />
                          {fault.recommendedAction}
                        </div>

                        {fault.state === 'resolved' && (fault.resolvedBy || fault.note) && (
                          <div className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
                            {fault.resolvedBy && <div>Resolved by {fault.resolvedBy}</div>}
                            {fault.note && <div className="mt-1">{fault.note}</div>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
