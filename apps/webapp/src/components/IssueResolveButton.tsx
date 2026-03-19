import type { MouseEvent } from 'react';
import { Zap } from 'lucide-react';

interface IssueResolveButtonProps {
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}

export default function IssueResolveButton({ onClick }: IssueResolveButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 border border-border px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
    >
      <Zap size={10} />
      Resolve
    </button>
  );
}
