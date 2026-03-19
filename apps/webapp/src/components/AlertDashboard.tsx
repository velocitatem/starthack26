import { useState } from 'react';
import { Link } from 'react-router-dom';
import { type Device, type Fault, type IssueAlertSelection } from '@/types/facility';
import {
  AlertOctagon, AlertTriangle, ChevronDown, Clock, ExternalLink,
  type LucideIcon, Siren, Wrench, Zap,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import PageHeader from '@/components/PageHeader';
import IssueResolveButton from '@/components/IssueResolveButton';

interface AlertDashboardProps {
  devices: Device[];
  onNavigateToDevice: (device: Device) => void;
  onOpenIssueResult: (selection: IssueAlertSelection) => void;
}

interface AlertItem {
  device: Device;
  fault: Fault;
}

interface SummaryCard {
  label: string;
  count: number | string;
  color: string;
  text: string;
  icon: LucideIcon;
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

const fmtTs = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export default function AlertDashboard({ devices, onNavigateToDevice, onOpenIssueResult }: AlertDashboardProps) {
  const [severityFilter, setSeverityFilter] = useState<string | null>(null);
  const [deviceFilter, setDeviceFilter] = useState<string | null>(null);
  const [expandedFaultId, setExpandedFaultId] = useState<string | null>(null);

  const alerts: AlertItem[] = devices
    .flatMap(device => device.faults.map(fault => ({ device, fault })))
    .sort((a, b) => severityOrder[a.fault.severity] - severityOrder[b.fault.severity]);

  const uniqueDeviceIds = [...new Set(devices.map(device => device.id))].sort();
  const filtered = alerts
    .filter(alert => !severityFilter || alert.fault.severity === severityFilter)
    .filter(alert => !deviceFilter || alert.device.id === deviceFilter);
  const totalEnergyWaste = `${alerts.reduce((sum, alert) => sum + parseEnergyWaste(alert.fault.energyWaste), 0).toLocaleString()} kWh/day`;
  const summaryCards: SummaryCard[] = [
    { label: 'Critical', count: alerts.filter(alert => alert.fault.severity === 'critical').length, color: 'border-status-fault/30', text: 'text-status-fault', icon: AlertOctagon },
    { label: 'High', count: alerts.filter(alert => alert.fault.severity === 'high').length, color: 'border-status-warning/30', text: 'text-status-warning', icon: Siren },
    { label: 'Medium', count: alerts.filter(alert => alert.fault.severity === 'medium').length, color: 'border-border', text: 'text-muted-foreground', icon: AlertTriangle },
    { label: 'Total Energy Waste', count: totalEnergyWaste, color: 'border-border', text: 'text-foreground', icon: Zap },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <PageHeader title="Issues" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-6 grid grid-cols-4 gap-3">
          {summaryCards.map((card) => {
            const Icon = card.icon;
            const isActive = severityFilter === card.label.toLowerCase();

            return (
              <div
                key={card.label}
                className={`cursor-pointer border bg-card p-4 shadow-sm transition-shadow hover:shadow-md ${isActive ? 'card-accent-top border-foreground' : card.color}`}
                onClick={() => setSeverityFilter(isActive ? null : card.label === 'Total Energy Waste' ? null : card.label.toLowerCase())}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="label-caps">{card.label}</div>
                  <Icon size={14} className={card.text} />
                </div>
                <div className={`mt-1 font-display text-2xl ${card.text}`}>{card.count}</div>
              </div>
            );
          })}
        </div>

        <div className="mb-6 flex items-center gap-3">
          <div className="label-caps shrink-0">Device</div>
          <select
            value={deviceFilter ?? ''}
            onChange={(event) => setDeviceFilter(event.target.value || null)}
            className="h-8 min-w-[200px] border border-border bg-background px-2 text-[12px] outline-none"
          >
            <option value="">All devices</option>
            {uniqueDeviceIds.map(id => <option key={id} value={id}>{id}</option>)}
          </select>
          {deviceFilter && (
            <button
              type="button"
              onClick={() => setDeviceFilter(null)}
              className="text-[11px] text-muted-foreground underline transition-colors hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>

        <div className="border border-border bg-card">
          <div className="data-row data-row-header border-b border-border">
            <span className="label-caps flex-1">Fault</span>
            <span className="label-caps w-28">Device</span>
            <span className="label-caps w-28">Zone</span>
            <span className="label-caps w-24">Impact</span>
            <span className="label-caps w-20">Severity</span>
            <span className="w-20" />
          </div>

          {filtered.map(alert => {
            const isExpanded = expandedFaultId === alert.fault.id;

            return (
              <div key={alert.fault.id}>
                <div
                  className={`data-row cursor-pointer group ${isExpanded ? 'bg-muted/30' : ''}`}
                  onClick={() => onNavigateToDevice(alert.device)}
                >
                  <div className="flex min-w-0 flex-1 gap-1.5">
                    <button
                      type="button"
                      aria-label={isExpanded ? `Collapse ${alert.fault.type}` : `Expand ${alert.fault.type}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setExpandedFaultId(isExpanded ? null : alert.fault.id);
                      }}
                      className="mt-[1px] shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <ChevronDown size={12} className={`transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                    </button>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium">{alert.fault.type}</div>
                      {!isExpanded && (
                        <div className="truncate text-[11px] text-muted-foreground">
                          {alert.fault.diagnosis.slice(0, 80)}...
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="w-28 text-[12px] font-display text-secondary-foreground">{alert.device.id}</div>
                  <div className="w-28 truncate text-[12px] text-muted-foreground">{alert.device.zone}</div>
                  <div className="w-24">
                    <div className="flex items-center gap-1 text-[12px] font-display text-foreground">
                      <Zap size={10} />
                      {alert.fault.energyWaste}
                    </div>
                  </div>
                  <div className="flex w-20 items-center justify-center self-center">
                    <span className={`inline-block border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${severityBadge[alert.fault.severity]}`}>
                      {alert.fault.severity}
                    </span>
                  </div>
                  <div className="flex w-20 justify-end">
                    <IssueResolveButton
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenIssueResult({ device: alert.device, fault: alert.fault });
                      }}
                    />
                  </div>
                </div>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15, ease: [0.2, 0, 0, 1] }}
                      className="overflow-hidden border-b border-border"
                    >
                      <div className="space-y-3 bg-muted/20 py-4 pl-[34px] pr-5">
                        <div>
                          <div className="label-caps mb-1">Diagnosis</div>
                          <div className="text-[13px] leading-relaxed text-foreground/90">{alert.fault.diagnosis}</div>
                        </div>

                        <div>
                          <div className="label-caps mb-1 flex items-center gap-1.5">
                            <Wrench size={10} className="text-muted-foreground" />
                            Recommendation
                          </div>
                          <div className="text-[13px] leading-relaxed text-foreground/90">{alert.fault.recommendation}</div>
                        </div>

                        <div className="flex items-center gap-5 text-[12px] text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock size={11} />
                            Detected {fmtTs(alert.fault.detectedAt)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Zap size={11} />
                            {alert.fault.energyWaste}
                          </span>
                          <span>{alert.fault.estimatedImpact}</span>
                        </div>

                        <div className="flex items-center gap-3 pt-1">
                          <Link
                            to={`/devices/${alert.device.id}`}
                            className="inline-flex items-center gap-1 border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <ExternalLink size={10} />
                            View device
                          </Link>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
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
