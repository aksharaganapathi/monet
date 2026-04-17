import { create } from 'zustand';
import type { MonthSelection, Page, TransactionDatePreset } from '../lib/types';
import { getCurrentMonth } from '../lib/utils';

interface TransactionFilterState {
  search: string;
  type: 'all' | 'income' | 'expense' | 'flagged' | 'recurring';
  datePreset: TransactionDatePreset;
  customStartDate: string | null;
  customEndDate: string | null;
  categoryName: string | null;
}

interface UIState {
  activePage: Page;
  selectedMonth: MonthSelection;
  isCommandPaletteOpen: boolean;
  isTransactionFormOpen: boolean;
  editingTransactionId: number | null;
  isSidebarCollapsed: boolean;
  isPrivateMode: boolean;
  transactionFilters: TransactionFilterState;
  setActivePage: (page: Page) => void;
  setSelectedMonth: (month: MonthSelection) => void;
  jumpToCurrentMonth: () => void;
  stepSelectedMonth: (direction: -1 | 1) => void;
  toggleCommandPalette: () => void;
  togglePrivateMode: () => void;
  openTransactionForm: () => void;
  openTransactionFormForEdit: (id: number) => void;
  closeTransactionForm: () => void;
  toggleSidebar: () => void;
  setTransactionSearch: (search: string) => void;
  setTransactionTypeFilter: (type: TransactionFilterState['type']) => void;
  setTransactionDatePreset: (preset: TransactionDatePreset) => void;
  setTransactionCustomDateRange: (startDate: string | null, endDate: string | null) => void;
  setTransactionCategoryFilter: (categoryName: string | null) => void;
  clearTransactionFilters: () => void;
  applyTransactionCategoryMonthFilter: (categoryName: string, month: MonthSelection) => void;
}

function shiftMonth(month: MonthSelection, direction: -1 | 1): MonthSelection {
  const nextDate = new Date(month.year, month.month - 1 + direction, 1);
  return {
    year: nextDate.getFullYear(),
    month: nextDate.getMonth() + 1,
  };
}

function getDefaultTransactionFilters(): TransactionFilterState {
  return {
    search: '',
    type: 'all',
    datePreset: 'thisMonth',
    customStartDate: null,
    customEndDate: null,
    categoryName: null,
  };
}

export const useUIStore = create<UIState>((set) => ({
  activePage: 'dashboard',
  selectedMonth: getCurrentMonth(),
  isCommandPaletteOpen: false,
  isTransactionFormOpen: false,
  editingTransactionId: null,
  isSidebarCollapsed: false,
  isPrivateMode: false,
  transactionFilters: getDefaultTransactionFilters(),

  setActivePage: (page) => set({ activePage: page }),
  setSelectedMonth: (selectedMonth) => set({ selectedMonth }),
  jumpToCurrentMonth: () => set({ selectedMonth: getCurrentMonth() }),
  stepSelectedMonth: (direction) =>
    set((state) => ({ selectedMonth: shiftMonth(state.selectedMonth, direction) })),
  toggleCommandPalette: () => set((state) => ({ isCommandPaletteOpen: !state.isCommandPaletteOpen })),
  togglePrivateMode: () => set((state) => ({ isPrivateMode: !state.isPrivateMode })),
  openTransactionForm: () => set({ isTransactionFormOpen: true, editingTransactionId: null }),
  openTransactionFormForEdit: (id) => set({ isTransactionFormOpen: true, editingTransactionId: id }),
  closeTransactionForm: () => set({ isTransactionFormOpen: false, editingTransactionId: null }),
  toggleSidebar: () => set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),
  setTransactionSearch: (search) =>
    set((state) => ({ transactionFilters: { ...state.transactionFilters, search } })),
  setTransactionTypeFilter: (type) =>
    set((state) => ({ transactionFilters: { ...state.transactionFilters, type } })),
  setTransactionDatePreset: (datePreset) =>
    set((state) => ({
      transactionFilters: {
        ...state.transactionFilters,
        datePreset,
        ...(datePreset !== 'custom' ? { customStartDate: null, customEndDate: null } : {}),
      },
    })),
  setTransactionCustomDateRange: (customStartDate, customEndDate) =>
    set((state) => ({
      transactionFilters: {
        ...state.transactionFilters,
        datePreset: 'custom',
        customStartDate,
        customEndDate,
      },
    })),
  setTransactionCategoryFilter: (categoryName) =>
    set((state) => ({ transactionFilters: { ...state.transactionFilters, categoryName } })),
  clearTransactionFilters: () => set({ transactionFilters: getDefaultTransactionFilters() }),
  applyTransactionCategoryMonthFilter: (categoryName, month) =>
    set({
      activePage: 'transactions',
      selectedMonth: month,
      transactionFilters: {
        ...getDefaultTransactionFilters(),
        categoryName,
        datePreset: 'thisMonth',
      },
    }),
}));
