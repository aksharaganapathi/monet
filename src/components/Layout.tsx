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
      <Sidebar />
      <main className="relative z-10 flex-1 overflow-auto" role="main">
        <div className="mx-auto max-w-6xl px-5 pb-6 pt-5">
          {children}
        </div>
      </main>
      <TransactionFormModal />
      <CommandPalette />
    </div>
  );
}
