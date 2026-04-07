import { create } from 'zustand';
import type { Page } from '../lib/types';

interface UIState {
  activePage: Page;
  isCommandPaletteOpen: boolean;
  isTransactionFormOpen: boolean;
  editingTransactionId: number | null;
  isSidebarCollapsed: boolean;
  setActivePage: (page: Page) => void;
  toggleCommandPalette: () => void;
  openTransactionForm: () => void;
  openTransactionFormForEdit: (id: number) => void;
  closeTransactionForm: () => void;
  toggleSidebar: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  activePage: 'dashboard',
  isCommandPaletteOpen: false,
  isTransactionFormOpen: false,
  editingTransactionId: null,
  isSidebarCollapsed: false,

  setActivePage: (page) => set({ activePage: page }),
  toggleCommandPalette: () => set((s) => ({ isCommandPaletteOpen: !s.isCommandPaletteOpen })),
  openTransactionForm: () => set({ isTransactionFormOpen: true, editingTransactionId: null }),
  openTransactionFormForEdit: (id) => set({ isTransactionFormOpen: true, editingTransactionId: id }),
  closeTransactionForm: () => set({ isTransactionFormOpen: false, editingTransactionId: null }),
  toggleSidebar: () => set((s) => ({ isSidebarCollapsed: !s.isSidebarCollapsed })),
}));
