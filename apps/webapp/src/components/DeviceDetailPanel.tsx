import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertTriangle, Zap, Clock, Wrench } from 'lucide-react';
import { type Device } from '@/data/mockDevices';
import Sparkline from './Sparkline';

interface DeviceDetailPanelProps {
  device: Device | null;
  onClose: () => void;
}

const statusStyles: Record<string, string> = {
  healthy: 'text-status-healthy',
  warning: 'text-status-warning',
  fault: 'text-status-fault',
  offline: 'text-status-offline',
};

const severityStyles: Record<string, string> = {
  critical: 'border-status-fault bg-status-fault/10 text-status-fault',
  high: 'border-status-warning bg-status-warning/10 text-status-warning',
  medium: 'border-muted bg-muted text-muted-foreground',
  low: 'border-muted bg-muted text-muted-foreground',
};

const formatAnomalyConfidence = (value: number) => `${Math.round(value * 100)}%`;

export default function DeviceDetailPanel({ device, onClose }: DeviceDetailPanelProps) {
  return (
    <AnimatePresence>
      {device && (
        <motion.div
          initial={{ x: 360, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 360, opacity: 0 }}
          transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
          className="absolute right-0 top-0 w-[360px] h-full z-30 border-l border-border bg-card overflow-y-auto shadow-xl"
        >
          {/* Header */}
          <div className="px-5 py-4 border-b border-border flex items-start justify-between card-accent-top">
            <div>
              <div className="font-display text-sm tracking-tight">{device.name}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{device.id} · {device.model}</div>
            </div>
            <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
              <X size={16} />
            </button>
          </div>

          {/* Status */}
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${device.status === 'healthy' ? 'bg-status-healthy' : device.status === 'warning' ? 'bg-status-warning' : 'bg-status-fault'}`} />
              <span className={`text-[13px] font-medium capitalize ${statusStyles[device.status]}`}>{device.status}</span>
            </div>
            <div className="text-right">
              <div className="label-caps">Confidence Anomaly</div>
              <div className={`font-display text-lg ${device.anomalyScore > 0.7 ? 'text-status-fault' : device.anomalyScore > 0.4 ? 'text-status-warning' : 'text-status-healthy'}`}>
                {formatAnomalyConfidence(device.anomalyScore)}
              </div>
            </div>
          </div>

          {/* Device Meta */}
          <div className="px-5 py-3 border-b border-border grid grid-cols-2 gap-3">
            {[
              { label: 'Serial', value: device.serial },
              { label: 'Type', value: device.type },
              { label: 'Zone', value: device.zone },
              { label: 'Installed', value: device.installedDate },
            ].map(m => (
              <div key={m.label}>
                <div className="label-caps">{m.label}</div>
                <div className="text-[13px] text-secondary-foreground mt-0.5 capitalize">{m.value}</div>
              </div>
            ))}
          </div>

          {/* Telemetry */}
          <div className="px-5 py-4 border-b border-border">
            <div className="label-caps mb-3">Live Telemetry (24h)</div>
            <div className="space-y-4">
              {[
                { label: 'Torque (Nm)', data: device.torque, color: 'hsl(var(--brand))' },
                { label: 'Position (%)', data: device.position, color: 'hsl(var(--foreground))' },
                { label: 'Temperature (°C)', data: device.temperature, color: 'hsl(var(--status-warning))' },
              ].map(t => (
                <div key={t.label} className="flex items-center justify-between">
                  <div>
                    <div className="text-[11px] text-muted-foreground">{t.label}</div>
                    <div className="font-display text-sm mt-0.5">{t.data[t.data.length - 1]?.value.toFixed(1)}</div>
                  </div>
                  <Sparkline data={t.data} color={t.color} />
                </div>
              ))}
            </div>
          </div>

          {/* Faults */}
          {device.faults.length > 0 && (
            <div className="px-5 py-4">
              <div className="label-caps mb-3 flex items-center gap-1.5">
                <AlertTriangle size={10} />
                Active Faults ({device.faults.length})
              </div>
              <div className="space-y-3">
                {device.faults.map(fault => (
                  <div key={fault.id} className={`border p-3 fault-card-accent ${severityStyles[fault.severity]}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-display text-[12px] font-semibold">{fault.type}</span>
                      <span className="text-[10px] uppercase tracking-wider font-medium">{fault.severity}</span>
                    </div>
                    
                    <div className="text-[12px] leading-relaxed opacity-90 mb-3">{fault.diagnosis}</div>

                    <div className="border-t border-current/20 pt-2 mt-2">
                      <div className="flex items-start gap-1.5 mb-2">
                        <Wrench size={11} className="mt-0.5 shrink-0" />
                        <span className="text-[11px] leading-relaxed">{fault.recommendation}</span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px]">
                        <span className="flex items-center gap-1"><Zap size={10} />{fault.energyWaste}</span>
                        <span className="flex items-center gap-1"><Clock size={10} />{new Date(fault.detectedAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {device.faults.length === 0 && (
            <div className="px-5 py-8 text-center">
              <div className="text-status-healthy font-display text-sm">No Active Faults</div>
              <div className="text-[12px] text-muted-foreground mt-1">Device operating within normal parameters</div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
