import { create } from 'zustand';
import type { Account, CreateAccountDTO, UpdateAccountDTO } from '../lib/types';
import { accountRepository } from '../lib/repositories/accountRepository';
import { transactionRepository } from '../lib/repositories/transactionRepository';

interface AccountState {
  accounts: Account[];
  totalBalance: number;
  netWorthTrend: { date: string; value: number }[];
  loading: boolean;
  error: string | null;
  fetchAccounts: () => Promise<void>;
  addAccount: (dto: CreateAccountDTO) => Promise<void>;
  updateAccount: (dto: UpdateAccountDTO) => Promise<void>;
  deleteAccount: (id: number) => Promise<void>;
  refreshBalances: () => Promise<void>;
  fetchNetWorthTrend: () => Promise<void>;
}

export const useAccountStore = create<AccountState>((set, get) => ({
  accounts: [],
  totalBalance: 0,
  netWorthTrend: [],
  loading: false,
  error: null,

  fetchAccounts: async () => {
    set({ loading: true, error: null });
    try {
      const [accounts, totalBalance] = await Promise.all([
        accountRepository.getAll(),
        accountRepository.getTotalBalance(),
      ]);
      set({ accounts, totalBalance, loading: false });
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
      set({ accounts, totalBalance });
    } catch (e) {
      console.error("Account add error:", e);
      set({ error: (e as Error).message });
    }
  },

  updateAccount: async (dto) => {
    try {
      await accountRepository.update(dto);
      const accounts = await accountRepository.getAll();
      set({ accounts });
    } catch (e) {
      console.error("Account update error:", e);
      set({ error: (e as Error).message });
    }
  },

  deleteAccount: async (id) => {
    try {
      await accountRepository.delete(id);
      const [accounts, totalBalance] = await Promise.all([
        accountRepository.getAll(),
        accountRepository.getTotalBalance(),
      ]);
      set({ accounts, totalBalance });
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
    set({ accounts, totalBalance });
  },

  fetchNetWorthTrend: async () => {
    try {
      const totalBalance = get().totalBalance || (await accountRepository.getTotalBalance());
      const dailyChanges = await transactionRepository.getDailyBalanceChanges();

      if (dailyChanges.length === 0) {
        // No transactions yet — flat line at current balance
        const today = new Date().toISOString().split('T')[0];
        set({ netWorthTrend: [{ date: today, value: totalBalance }] });
        return;
      }

      // Sum all transaction changes to find the total historical delta
      const totalDelta = dailyChanges.reduce((sum, d) => sum + d.daily_change, 0);

      // The balance before any transactions were made
      const startingBalance = totalBalance - totalDelta;

      // Build cumulative running net worth
      let running = startingBalance;
      const trend = dailyChanges.map((d) => {
        running += d.daily_change;
        return { date: d.date, value: running };
      });

      set({ netWorthTrend: trend });
    } catch (e) {
      console.error("Net worth trend error:", e);
    }
  },
}));
