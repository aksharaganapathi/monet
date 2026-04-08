import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import { accountRepository } from './accountRepository';
import { TransactionSchema, TransactionWithDetailsSchema, MonthlySpendingSchema } from '../types';
import type { Transaction, TransactionWithDetails, CreateTransactionDTO, UpdateTransactionDTO } from '../types';

export const transactionRepository = {
  async getAll(limit = 100): Promise<TransactionWithDetails[]> {
    const rows = await invoke<unknown[]>('get_transactions', { limit });
    return z.array(TransactionWithDetailsSchema).parse(rows);
  },

  async getByAccount(accountId: number, limit = 50): Promise<TransactionWithDetails[]> {
    const rows = await invoke<unknown[]>('get_transactions_by_account', { accountId, limit });
    return z.array(TransactionWithDetailsSchema).parse(rows);
  },

  async getByDateRange(startDate: string, endDate: string): Promise<TransactionWithDetails[]> {
    const rows = await invoke<unknown[]>('get_transactions_by_date', { startDate, endDate });
    return z.array(TransactionWithDetailsSchema).parse(rows);
  },

  async getMonthlySpending(year: number, month: number): Promise<{ category_name: string; total: number }[]> {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(month).padStart(2, '0')}-31`;
    const rows = await invoke<unknown[]>('get_monthly_spending', { startDate, endDate });
    return z.array(MonthlySpendingSchema).parse(rows);
  },

  async getMonthlyTotal(year: number, month: number): Promise<number> {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(month).padStart(2, '0')}-31`;
    const rows = await invoke<{ total: number }[]>('get_monthly_total_spent', { startDate, endDate });
    return rows[0]?.total ?? 0;
  },

  async create(dto: CreateTransactionDTO): Promise<Transaction> {
    const result = await invoke<{ lastInsertId: number }>('create_transaction', { 
      amount: dto.amount, 
      categoryId: dto.category_id,
      accountId: dto.account_id,
      date: dto.date, 
      note: dto.note ?? null 
    });
    
    if (result.lastInsertId == null) {
      throw new Error('Failed to create transaction: missing inserted id');
    }
    // Update account balance
    await accountRepository.updateBalance(dto.account_id, dto.amount);
    
    const rows = await invoke<unknown[]>('get_transaction_by_id', { id: result.lastInsertId });
    if (!rows || rows.length === 0) {
      throw new Error('Failed to create transaction: row not found after insert');
    }
    return TransactionSchema.parse(rows[0]);
  },

  async delete(id: number): Promise<void> {
    const rows = await invoke<unknown[]>('get_transaction_by_id', { id });
    if (rows && rows.length > 0) {
      const txn = TransactionSchema.parse(rows[0]);
      await accountRepository.updateBalance(txn.account_id, -txn.amount);
    }
    await invoke('delete_transaction', { id });
  },

  async update(dto: UpdateTransactionDTO): Promise<void> {
    await invoke('update_transaction', {
      id: dto.id,
      amount: dto.amount,
      categoryId: dto.category_id,
      accountId: dto.account_id,
      date: dto.date,
      note: dto.note ?? null,
    });
  },

  async setFlagged(id: number, flagged: boolean): Promise<void> {
    await invoke('set_transaction_flagged', { id, flagged });
  },

  async getDailyBalanceChanges(): Promise<{ date: string; daily_change: number }[]> {
    const rows = await invoke<{ date: string; daily_change: number }[]>('get_daily_balance_changes');
    return rows ?? [];
  },
};
