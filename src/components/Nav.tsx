import { Search } from 'lucide-react';
import { useUIStore } from '../store/uiStore';
import monetLogo from '../monet_logo.svg';

export function Nav() {
  const { toggleCommandPalette } = useUIStore();

  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-border px-6 py-5">
      <div className="flex h-14 items-center rounded-[20px] border border-border bg-white px-4">
        <img src={monetLogo} alt="Monet" className="h-9 w-auto object-contain" />
      </div>

      <button
        onClick={toggleCommandPalette}
        className="flex min-w-[240px] flex-1 items-center gap-3 rounded-[18px] border border-border bg-white px-4 py-3 text-text-tertiary transition-colors hover:bg-surface-muted"
      >
        <Search size={16} />
        <span className="flex-1 text-left text-sm font-medium">Search transactions, accounts, or commands</span>
        <span className="rounded-full border border-border bg-surface-muted px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-text-secondary">
          Ctrl K
        </span>
      </button>
    </div>
  );
}
