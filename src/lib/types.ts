// Monet — Type definitions
import { z } from 'zod';

// ─── Zod Schemas ───

export const AccountSchema = z.object({
  id: z.number(),
  name: z.string(),
  type: z.enum(['checking', 'savings']),
  balance: z.number(),
  institution: z.string().default('other'),
  created_at: z.string(),
  updated_at: z.string(),
});

export const CategorySchema = z.object({
  id: z.number(),
  name: z.string(),
  icon: z.string().nullable(),
  is_custom: z.number(),
  created_at: z.string(),
});

export const TransactionSchema = z.object({
  id: z.number(),
  amount: z.number(),
  category_id: z.number(),
  account_id: z.number(),
  date: z.string(),
  note: z.string().nullable(),
  created_at: z.string(),
});

export const BudgetSchema = z.object({
  id: z.number(),
  category_id: z.number(),
  monthly_limit: z.number(),
});

export const RecurringSchema = z.object({
  id: z.number(),
  amount: z.number(),
  category_id: z.number(),
  account_id: z.number(),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  next_run_date: z.string(),
  note: z.string().nullable(),
});

export const TransactionWithDetailsSchema = TransactionSchema.extend({
  category_name: z.string(),
  category_icon: z.string().nullable(),
  account_name: z.string(),
});

export const MonthlySpendingSchema = z.object({
  category_name: z.string(),
  total: z.number()
});

// ─── Database Models ───

export type Account = z.infer<typeof AccountSchema>;
export type Category = z.infer<typeof CategorySchema>;
export type Transaction = z.infer<typeof TransactionSchema>;
export type Budget = z.infer<typeof BudgetSchema>;
export type Recurring = z.infer<typeof RecurringSchema>;

// ─── Form DTOs ───

export interface CreateAccountDTO {
  name: string;
  type: 'checking' | 'savings';
  balance: number;
  institution: string;
}

export interface UpdateAccountDTO {
  id: number;
  name: string;
  type: 'checking' | 'savings';
  institution: string;
}

export interface CreateTransactionDTO {
  amount: number;
  category_id: number;
  account_id: number;
  date: string;
  note?: string;
}

export interface UpdateTransactionDTO {
  id: number;
  amount: number;
  category_id: number;
  account_id: number;
  date: string;
  note?: string;
}

export interface CreateCategoryDTO {
  name: string;
  icon?: string;
}

export interface SetupStatus {
  isConfigured: boolean;
  userName: string | null;
  biometricEnabled: boolean;
  canUseBiometricUnlock: boolean;
}

// ─── Enriched Types (with joins) ───

export type TransactionWithDetails = z.infer<typeof TransactionWithDetailsSchema>;

// ─── UI Types ───

export type Page = 'dashboard' | 'insights' | 'accounts' | 'transactions' | 'categories' | 'settings';
