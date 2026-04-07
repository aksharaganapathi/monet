import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import { AccountSchema } from '../types';
import type { Account, CreateAccountDTO, UpdateAccountDTO } from '../types';

export const accountRepository = {
  async getAll(): Promise<Account[]> {
    const rows = await invoke<unknown[]>('get_accounts');
    return z.array(AccountSchema).parse(rows);
  },

  async getById(id: number): Promise<Account | null> {
    const rows = await invoke<unknown[]>('get_account_by_id', { id });
    if (!rows || rows.length === 0) return null;
    return AccountSchema.parse(rows[0]);
  },

  async create(dto: CreateAccountDTO): Promise<Account> {
    const result = await invoke<{ lastInsertId: number }>('create_account', { 
      name: dto.name, 
      type: dto.type, 
      balance: dto.balance,
      institution: dto.institution
    });
    
    if (result.lastInsertId == null) {
      throw new Error('Failed to create account: missing inserted id');
    }
    const rows = await invoke<unknown[]>('get_account_by_id', { id: result.lastInsertId });
    if (!rows || rows.length === 0) {
      throw new Error('Failed to create account: row not found after insert');
    }
    return AccountSchema.parse(rows[0]);
  },

  async update(dto: UpdateAccountDTO): Promise<Account> {
    await invoke('update_account', { 
      id: dto.id, 
      name: dto.name, 
      type: dto.type,
      institution: dto.institution
    });
    
    const rows = await invoke<unknown[]>('get_account_by_id', { id: dto.id });
    if (!rows || rows.length === 0) {
      throw new Error('Failed to update account: row not found');
    }
    return AccountSchema.parse(rows[0]);
  },

  async updateBalance(id: number, delta: number): Promise<void> {
    await invoke('update_account_balance', { id, delta });
  },

  async setBalance(id: number, newBalance: number, note?: string): Promise<void> {
    await invoke('set_account_balance', {
      id,
      newBalance,
      note: note ?? null,
    });
  },

  async delete(id: number): Promise<void> {
    await invoke('delete_account', { id });
  },

  async getTotalBalance(): Promise<number> {
    const rows = await invoke<{ total: number }[]>('get_total_balance');
    return rows[0]?.total ?? 0;
  },

  async getBalanceSnapshots(): Promise<{ date: string; value: number }[]> {
    const rows = await invoke<{ date: string; value: number }[]>('get_balance_snapshots');
    return (rows ?? []).map((row) => ({ date: row.date, value: Number(row.value) }));
  },
};
