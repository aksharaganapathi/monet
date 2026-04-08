import { create } from 'zustand';
import type { Account, CreateAccountDTO, UpdateAccountDTO } from '../lib/types';
import { accountRepository } from '../lib/repositories/accountRepository';

interface AccountState {
  accounts: Account[];
  totalBalance: number;
  netWorthTrend: { date: string; value: number }[];
  hasLoaded: boolean;
  loading: boolean;
  error: string | null;
  fetchAccounts: (force?: boolean) => Promise<void>;
  addAccount: (dto: CreateAccountDTO) => Promise<void>;
  updateAccount: (dto: UpdateAccountDTO) => Promise<void>;
  setAccountBalance: (id: number, newBalance: number, note?: string) => Promise<void>;
  deleteAccount: (id: number) => Promise<void>;
  refreshBalances: () => Promise<void>;
  fetchNetWorthTrend: () => Promise<void>;
}

export const useAccountStore = create<AccountState>((set, get) => ({
  accounts: [],
  totalBalance: 0,
  netWorthTrend: [],
  hasLoaded: false,
  loading: false,
  error: null,

  fetchAccounts: async (force = false) => {
    if (!force && get().hasLoaded) {
      return;
    }

    set({ loading: true, error: null });
    try {
      const [accounts, totalBalance] = await Promise.all([
        accountRepository.getAll(),
        accountRepository.getTotalBalance(),
      ]);
      set({ accounts, totalBalance, hasLoaded: true, loading: false });
    } catch (e) {
      console.error("Account fetch error:", e);
      set({ error: (e as Error).message, loading: false });
    }
  },

  addAccount: async (dto) => {
    try {
      await accountRepository.create(dto);
      const [accounts, totalBalance] = await Promise.all([
        accountRepository.getAll(),
        accountRepository.getTotalBalance(),
      ]);
      set({ accounts, totalBalance, hasLoaded: true, error: null });
    } catch (e) {
      console.error("Account add error:", e);
      set({ error: (e as Error).message });
      throw e;
    }
  },

  updateAccount: async (dto) => {
    try {
      await accountRepository.update(dto);
      const accounts = await accountRepository.getAll();
      set({ accounts, hasLoaded: true });
    } catch (e) {
      console.error("Account update error:", e);
      set({ error: (e as Error).message });
    }
  },

  setAccountBalance: async (id, newBalance, note) => {
    try {
      await accountRepository.setBalance(id, newBalance, note);
      const [accounts, totalBalance] = await Promise.all([
        accountRepository.getAll(),
        accountRepository.getTotalBalance(),
      ]);
      set({ accounts, totalBalance, hasLoaded: true, error: null });
    } catch (e) {
      console.error("Account balance set error:", e);
      set({ error: (e as Error).message });
      throw e;
    }
  },

  deleteAccount: async (id) => {
    try {
      await accountRepository.delete(id);
      const [accounts, totalBalance] = await Promise.all([
        accountRepository.getAll(),
        accountRepository.getTotalBalance(),
      ]);
      set({ accounts, totalBalance, hasLoaded: true });
    } catch (e) {
      console.error("Account delete error:", e);
      set({ error: (e as Error).message });
    }
  },

  refreshBalances: async () => {
    const [accounts, totalBalance] = await Promise.all([
      accountRepository.getAll(),
      accountRepository.getTotalBalance(),
    ]);
    set({ accounts, totalBalance, hasLoaded: true });
  },

  fetchNetWorthTrend: async () => {
    try {
      const snapshots = await accountRepository.getBalanceSnapshots();
      set({ netWorthTrend: snapshots });
    } catch (e) {
      console.error("Net worth trend error:", e);
    }
  },
}));
