import { create } from 'zustand';
import type { Page } from '../lib/types';

interface UIState {
  activePage: Page;
  isCommandPaletteOpen: boolean;
  isTransactionFormOpen: boolean;
  isSidebarCollapsed: boolean;
  setActivePage: (page: Page) => void;
  toggleCommandPalette: () => void;
  openTransactionForm: () => void;
  closeTransactionForm: () => void;
  toggleSidebar: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  activePage: 'dashboard',
  isCommandPaletteOpen: false,
  isTransactionFormOpen: false,
  isSidebarCollapsed: false,

  setActivePage: (page) => set({ activePage: page }),
  toggleCommandPalette: () => set((s) => ({ isCommandPaletteOpen: !s.isCommandPaletteOpen })),
  openTransactionForm: () => set({ isTransactionFormOpen: true }),
  closeTransactionForm: () => set({ isTransactionFormOpen: false }),
  toggleSidebar: () => set((s) => ({ isSidebarCollapsed: !s.isSidebarCollapsed })),
}));
