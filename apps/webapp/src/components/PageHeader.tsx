import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: ReactNode;
  actions?: ReactNode;
}

export default function PageHeader({ title, actions }: PageHeaderProps) {
  return (
    <div className="px-6 h-16 flex items-center justify-between shrink-0 border-b border-border">
      <h1 className="font-display text-base tracking-tight">{title}</h1>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
