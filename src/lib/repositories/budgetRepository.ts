import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import { BudgetProgressSchema, BudgetSchema } from '../types';
import type { Budget, BudgetProgress } from '../types';

export const budgetRepository = {
  async getAll(): Promise<Budget[]> {
    const rows = await invoke<unknown[]>('get_budgets');
    return z.array(BudgetSchema).parse(rows);
  },

  async upsert(categoryId: number, amount: number): Promise<Budget> {
    await invoke('upsert_budget', { categoryId, amount });
    const budgets = await this.getAll();
    const budget = budgets.find((entry) => entry.category_id === categoryId);
    if (!budget) {
      throw new Error('Failed to save budget');
    }
    return budget;
  },

  async delete(id: number): Promise<void> {
    await invoke('delete_budget', { id });
  },

  async getProgress(month: string): Promise<BudgetProgress[]> {
    const rows = await invoke<unknown[]>('get_budget_progress', { month });
    return z.array(BudgetProgressSchema).parse(rows);
  },
};
