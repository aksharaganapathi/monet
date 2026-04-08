import { z } from 'zod';

export const AccountSchema = z.object({
  id: z.number(),
  name: z.string(),
  type: z.enum(['checking', 'savings', 'investment', 'cash']),
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
  flagged: z.union([z.number(), z.boolean()]).transform((value) => Boolean(value)),
  created_at: z.string(),
});

export const BudgetSchema = z.object({
  id: z.number(),
  category_id: z.number(),
  amount: z.number(),
  period: z.literal('monthly'),
  created_at: z.string(),
  updated_at: z.string(),
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
  total: z.number(),
});

export const BudgetProgressSchema = z.object({
  budget: BudgetSchema,
  category: CategorySchema,
  spent: z.number(),
  remaining: z.number(),
  percent_used: z.number(),
});

export type Account = z.infer<typeof AccountSchema>;
export type Category = z.infer<typeof CategorySchema>;
export type Transaction = z.infer<typeof TransactionSchema>;
export type Budget = z.infer<typeof BudgetSchema>;
export type Recurring = z.infer<typeof RecurringSchema>;
export type TransactionWithDetails = z.infer<typeof TransactionWithDetailsSchema>;
export type BudgetProgress = z.infer<typeof BudgetProgressSchema>;

export interface CreateAccountDTO {
  name: string;
  type: 'checking' | 'savings' | 'investment' | 'cash';
  balance: number;
  institution: string;
}

export interface UpdateAccountDTO {
  id: number;
  name: string;
  type: 'checking' | 'savings' | 'investment' | 'cash';
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

export interface MonthSelection {
  year: number;
  month: number;
}

export type TransactionDatePreset = 'thisMonth' | 'lastMonth' | 'last3Months' | 'custom';

export type Page = 'dashboard' | 'insights' | 'accounts' | 'transactions' | 'budgets' | 'categories' | 'settings';
