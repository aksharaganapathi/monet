import { create } from 'zustand';
import type { TransactionWithDetails, CreateTransactionDTO, UpdateTransactionDTO } from '../lib/types';
import { transactionRepository } from '../lib/repositories/transactionRepository';
import { useAccountStore } from './accountStore';

interface TransactionState {
  transactions: TransactionWithDetails[];
  monthlySpending: { category_name: string; total: number }[];
  monthlyTotal: number;
  predictedEndOfMonthSpend: number;
  hasLoaded: boolean;
  loading: boolean;
  error: string | null;
  fetchTransactions: (force?: boolean) => Promise<void>;
  fetchMonthlySpending: (year: number, month: number) => Promise<void>;
  addTransaction: (dto: CreateTransactionDTO) => Promise<void>;
  updateTransaction: (dto: UpdateTransactionDTO) => Promise<void>;
  deleteTransaction: (id: number) => Promise<void>;
}

export const useTransactionStore = create<TransactionState>((set, get) => ({
  transactions: [],
  monthlySpending: [],
  monthlyTotal: 0,
  predictedEndOfMonthSpend: 0,
  hasLoaded: false,
  loading: false,
  error: null,

  fetchTransactions: async (force = false) => {
    if (!force && get().hasLoaded) {
      return;
    }

    set({ loading: true, error: null });
    try {
      const transactions = await transactionRepository.getAll(200);
      set({ transactions, hasLoaded: true, loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  fetchMonthlySpending: async (year, month) => {
    try {
      const [monthlySpending, monthlyTotal] = await Promise.all([
        transactionRepository.getMonthlySpending(year, month),
        transactionRepository.getMonthlyTotal(year, month),
      ]);

      // Simple Predictive Analytics: Calculate run rate
      const today = new Date();
      let predictedEndOfMonthSpend = monthlyTotal;
      
      // Only predict for the current month
      if (today.getFullYear() === year && today.getMonth() + 1 === month) {
        const currentDay = today.getDate();
        const daysInMonth = new Date(year, month, 0).getDate();
        if (currentDay > 0) {
          const runRate = monthlyTotal / currentDay;
          predictedEndOfMonthSpend = runRate * daysInMonth;
        }
      }

      set({ monthlySpending, monthlyTotal, predictedEndOfMonthSpend });
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  addTransaction: async (dto) => {
    try {
      await transactionRepository.create(dto);
      const transactions = await transactionRepository.getAll(200);
      set({ transactions, hasLoaded: true, error: null });
      // Refresh account balances
      await useAccountStore.getState().refreshBalances();
    } catch (e) {
      set({ error: (e as Error).message });
      throw e;
    }
  },

  updateTransaction: async (dto) => {
    try {
      await transactionRepository.update(dto);
      const transactions = await transactionRepository.getAll(200);
      set({ transactions, hasLoaded: true, error: null });
      await useAccountStore.getState().refreshBalances();
    } catch (e) {
      set({ error: (e as Error).message });
      throw e;
    }
  },

  deleteTransaction: async (id) => {
    try {
      await transactionRepository.delete(id);
      const transactions = await transactionRepository.getAll(200);
      set({ transactions, hasLoaded: true, error: null });
      // Refresh account balances
      await useAccountStore.getState().refreshBalances();
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },
}));
