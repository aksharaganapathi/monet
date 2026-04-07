import React from 'react';
import { Sidebar } from './Sidebar';
import { TransactionFormModal } from '../features/transactions/TransactionFormModal';
import { CommandPalette } from './CommandPalette';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-transparent">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(168,139,74,0.14),transparent_45%),radial-gradient(circle_at_85%_85%,rgba(80,139,120,0.1),transparent_48%)]"
      />
      <Sidebar />
      <main className="relative z-10 flex-1 overflow-hidden" role="main">
        <div className="mx-auto h-full max-w-[1420px] px-5 py-5">
          {children}
        </div>
      </main>
      <TransactionFormModal />
      <CommandPalette />
    </div>
  );
}
