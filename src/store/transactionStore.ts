import { create } from 'zustand';
import type { TransactionWithDetails, CreateTransactionDTO, UpdateTransactionDTO } from '../lib/types';
import { transactionRepository } from '../lib/repositories/transactionRepository';
import { useAccountStore } from './accountStore';

interface TransactionState {
  transactions: TransactionWithDetails[];
  hasLoaded: boolean;
  loading: boolean;
  error: string | null;
  fetchTransactions: (force?: boolean) => Promise<void>;
  addTransaction: (dto: CreateTransactionDTO) => Promise<void>;
  updateTransaction: (dto: UpdateTransactionDTO) => Promise<void>;
  deleteTransaction: (id: number) => Promise<void>;
  setTransactionFlagged: (id: number, flagged: boolean) => Promise<void>;
}

export const useTransactionStore = create<TransactionState>((set, get) => ({
  transactions: [],
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

  setTransactionFlagged: async (id, flagged) => {
    try {
      await transactionRepository.setFlagged(id, flagged);
      const transactions = await transactionRepository.getAll(200);
      set({ transactions, hasLoaded: true, error: null });
    } catch (error) {
      set({ error: (error as Error).message });
      throw error;
    }
  },
}));
