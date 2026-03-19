import type { ReactNode } from 'react';
import { ModeToggle } from '@/components/mode-toggle';

interface PageHeaderProps {
  title: ReactNode;
  actions?: ReactNode;
}

export default function PageHeader({ title, actions }: PageHeaderProps) {
  return (
    <div className="px-6 h-16 flex items-center justify-between shrink-0 border-b border-border">
      <h1 className="font-display text-base tracking-tight">{title}</h1>
      <div className="flex items-center gap-2">
        {actions}
        <ModeToggle />
      </div>
    </div>
  );
}
