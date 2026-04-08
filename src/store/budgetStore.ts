import { create } from 'zustand';
import type { Budget, BudgetProgress } from '../lib/types';
import { budgetRepository } from '../lib/repositories/budgetRepository';

interface BudgetState {
  budgets: Budget[];
  progress: BudgetProgress[];
  hasLoaded: boolean;
  loading: boolean;
  error: string | null;
  fetchBudgets: (force?: boolean) => Promise<void>;
  fetchBudgetProgress: (month: string) => Promise<void>;
  upsertBudget: (categoryId: number, amount: number, month: string) => Promise<void>;
  deleteBudget: (id: number, month: string) => Promise<void>;
}

export const useBudgetStore = create<BudgetState>((set, get) => ({
  budgets: [],
  progress: [],
  hasLoaded: false,
  loading: false,
  error: null,

  fetchBudgets: async (force = false) => {
    if (!force && get().hasLoaded) {
      return;
    }

    set({ loading: true, error: null });
    try {
      const budgets = await budgetRepository.getAll();
      set({ budgets, hasLoaded: true, loading: false });
    } catch (error) {
      set({ loading: false, error: (error as Error).message });
    }
  },

  fetchBudgetProgress: async (month) => {
    set({ loading: true, error: null });
    try {
      const [budgets, progress] = await Promise.all([
        budgetRepository.getAll(),
        budgetRepository.getProgress(month),
      ]);
      set({ budgets, progress, hasLoaded: true, loading: false });
    } catch (error) {
      set({ loading: false, error: (error as Error).message });
    }
  },

  upsertBudget: async (categoryId, amount, month) => {
    try {
      await budgetRepository.upsert(categoryId, amount);
      const [budgets, progress] = await Promise.all([
        budgetRepository.getAll(),
        budgetRepository.getProgress(month),
      ]);
      set({ budgets, progress, hasLoaded: true, error: null });
    } catch (error) {
      set({ error: (error as Error).message });
      throw error;
    }
  },

  deleteBudget: async (id, month) => {
    try {
      await budgetRepository.delete(id);
      const [budgets, progress] = await Promise.all([
        budgetRepository.getAll(),
        budgetRepository.getProgress(month),
      ]);
      set({ budgets, progress, hasLoaded: true, error: null });
    } catch (error) {
      set({ error: (error as Error).message });
      throw error;
    }
  },
}));
