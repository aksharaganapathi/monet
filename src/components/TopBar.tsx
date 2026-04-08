import { useRef } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Button } from './ui/Button';
import { useUIStore } from '../store/uiStore';
import { useKeyboardShortcut } from '../hooks/useKeyboardShortcut';
import { getMonthName } from '../lib/utils';

export function TopBar() {
  const navigatorRef = useRef<HTMLDivElement>(null);
  const {
    selectedMonth,
    stepSelectedMonth,
    jumpToCurrentMonth,
    openTransactionForm,
  } = useUIStore();

  useKeyboardShortcut('n', openTransactionForm, { ctrl: true });
  useKeyboardShortcut('t', jumpToCurrentMonth, { ctrl: true });

  const handleNavigatorKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      stepSelectedMonth(-1);
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      stepSelectedMonth(1);
    }
  };

  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div
        ref={navigatorRef}
        tabIndex={0}
        onKeyDown={handleNavigatorKeyDown}
        className="surface-card flex items-center gap-2 rounded-xl px-2 py-1.5 outline-none focus:ring-2 focus:ring-accent/25"
        aria-label="Month navigator"
      >
        <button
          type="button"
          onClick={() => stepSelectedMonth(-1)}
          className="rounded-lg p-1.5 text-text-secondary transition-colors hover:bg-accent-subtle hover:text-text-primary"
          aria-label="Previous month"
        >
          <ChevronLeft size={16} />
        </button>

        <button
          type="button"
          onClick={jumpToCurrentMonth}
          className="min-w-32 rounded-lg px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-accent-subtle"
          title="Jump to current month (Ctrl/Cmd+T)"
        >
          {getMonthName(selectedMonth.month)} {selectedMonth.year}
        </button>

        <button
          type="button"
          onClick={() => stepSelectedMonth(1)}
          className="rounded-lg p-1.5 text-text-secondary transition-colors hover:bg-accent-subtle hover:text-text-primary"
          aria-label="Next month"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <Button icon={<Plus size={16} />} onClick={openTransactionForm} className="justify-center" title="Add transaction (Ctrl/Cmd+N)">
        Add Transaction
      </Button>
    </div>
  );
}
