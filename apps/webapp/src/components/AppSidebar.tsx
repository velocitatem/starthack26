import { Link } from 'react-router-dom';
import { type BuildingStats } from '@/types/facility';
import { AlertTriangle, Bot, Map, PanelLeftClose, PanelLeftOpen, Server, type LucideIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface AppSidebarProps {
  activeView: 'map' | 'issues' | 'devices' | 'agent';
  buildingStats: BuildingStats;
  collapsed: boolean;
  onToggle: () => void;
}

const NavItem = ({
  icon: Icon,
  label,
  to,
  active,
  collapsed,
}: {
  icon: LucideIcon;
  label: string;
  to: string;
  active: boolean;
  collapsed: boolean;
}) => {
  const link = (
    <Link
      to={to}
      className={`w-full flex items-center gap-3 ${collapsed ? 'justify-center px-0' : 'px-4'} py-2.5 text-[13px] font-medium transition-colors ${
        active ? 'bg-muted text-foreground sidebar-active-bar' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
      }`}
    >
      <Icon size={16} strokeWidth={1.5} />
      {!collapsed && label}
    </Link>
  );

  if (!collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" className="text-[12px]">
        {label}
      </TooltipContent>
    </Tooltip>
  );
};

const statusItems = [
  { label: 'Healthy', key: 'healthyDevices' as const, color: 'bg-status-healthy' },
  { label: 'Warning', key: 'warningDevices' as const, color: 'bg-status-warning' },
  { label: 'Fault', key: 'faultDevices' as const, color: 'bg-status-fault' },
];

export default function AppSidebar({ activeView, buildingStats, collapsed, onToggle }: AppSidebarProps) {
  return (
    <aside
      className={`${collapsed ? 'w-[56px]' : 'w-[260px]'} h-screen bg-card border-r border-border flex flex-col shrink-0 transition-[width] duration-200`}
      style={{ transitionTimingFunction: 'var(--ease-swift)' }}
    >
      <div className={`${collapsed ? 'px-2 justify-center' : 'px-4 justify-between'} h-16 border-b border-border flex items-center`}>
        {!collapsed && (
          <div className="font-display text-base tracking-tight text-foreground flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="w-5 h-5 shrink-0" aria-hidden />
            Flox
          </div>
        )}
        <button onClick={onToggle} className="text-muted-foreground hover:text-foreground transition-colors p-1">
          {collapsed ? <PanelLeftOpen size={16} strokeWidth={1.5} /> : <PanelLeftClose size={16} strokeWidth={1.5} />}
        </button>
      </div>

      <div className="py-2 border-b border-border">
        <NavItem icon={Map} label="Map" to="/" active={activeView === 'map'} collapsed={collapsed} />
        <NavItem icon={AlertTriangle} label="Issues" to="/issues" active={activeView === 'issues'} collapsed={collapsed} />
        <NavItem icon={Server} label="Devices" to="/devices" active={activeView === 'devices'} collapsed={collapsed} />
        <NavItem icon={Bot} label="Agent" to="/agent" active={activeView === 'agent'} collapsed={collapsed} />
      </div>

      <div className="py-2 flex-1 overflow-hidden">
        {!collapsed ? (
          <>
            <div className="label-caps px-4 py-2 !text-muted-foreground/60">Device Status</div>
            <div className="px-4 space-y-2 mt-1">
              {statusItems.map(s => (
                <div key={s.label} className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <span className={`w-2 h-2 rounded-full ${s.color}`} />
                  <span className="flex-1">{s.label}</span>
                  <span className="font-display text-foreground">{buildingStats[s.key]}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 mt-2">
            {statusItems.map(s => (
              <Tooltip key={s.label}>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${s.color}`} />
                    <span className="font-display text-[11px] text-foreground">{buildingStats[s.key]}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-[12px]">
                  {s.label}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
