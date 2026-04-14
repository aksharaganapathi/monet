import React from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { getMonthName } from '../lib/utils';
import type { Page } from '../lib/types';
import { useUIStore } from '../store/uiStore';
import { TransactionFormModal } from '../features/transactions/TransactionFormModal';
import { CommandPalette } from './CommandPalette';
import { Nav } from './Nav';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const {
    activePage,
    setActivePage,
    selectedMonth,
    stepSelectedMonth,
    jumpToCurrentMonth,
    openTransactionForm,
  } = useUIStore();

  const tabs: { id: Page; label: string }[] = [
    { id: 'dashboard', label: 'Overview' },
    { id: 'accounts', label: 'Wallet' },
    { id: 'insights', label: 'Analytics' },
    { id: 'transactions', label: 'Transactions' },
    { id: 'budgets', label: 'Budgets' },
    { id: 'settings', label: 'Settings' },
    { id: 'categories', label: 'Categories' },
  ];

  return (
    <div className="relative min-h-screen w-screen overflow-hidden bg-surface">
      <div className="flex h-screen w-full flex-col px-3 py-3 sm:px-4 sm:py-4">
        <div className="glass-card flex min-h-0 flex-1 flex-col rounded-[30px] border border-border bg-surface-elevated">
          <Nav />

          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-4">
            <div className="flex flex-wrap items-center gap-2">
              {tabs.map((tab) => {
                const isActive = tab.id === activePage;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActivePage(tab.id)}
                    className={`rounded-full px-4 py-2.5 text-sm font-semibold transition-all ${
                      isActive
                        ? 'bg-accent text-white'
                        : 'text-text-secondary hover:bg-accent-subtle hover:text-text-primary'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded-[18px] border border-border bg-white px-2 py-1.5">
                <button
                  onClick={() => stepSelectedMonth(-1)}
                  className="rounded-xl p-2 text-text-tertiary transition-colors hover:bg-surface-muted hover:text-text-primary"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={jumpToCurrentMonth}
                  className="min-w-[120px] px-2 text-center text-sm font-semibold text-text-primary transition-colors hover:text-accent"
                >
                  {getMonthName(selectedMonth.month)} {selectedMonth.year}
                </button>
                <button
                  onClick={() => stepSelectedMonth(1)}
                  className="rounded-xl p-2 text-text-tertiary transition-colors hover:bg-surface-muted hover:text-text-primary"
                >
                  <ChevronRight size={16} />
                </button>
              </div>

              <button
                onClick={openTransactionForm}
                className="group flex h-11 items-center gap-2 rounded-[18px] bg-accent px-4 text-sm font-bold text-white transition-all hover:bg-accent-hover active:scale-95"
              >
                <Plus size={16} className="opacity-80 group-hover:opacity-100" />
                New transaction
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden px-6 pb-6 pt-5">{children}</div>
        </div>
      </div>

      <TransactionFormModal />
      <CommandPalette />
    </div>
  );
}
