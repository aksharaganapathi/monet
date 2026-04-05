import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import { CategorySchema } from '../types';
import type { Category, CreateCategoryDTO } from '../types';

export const categoryRepository = {
  async getAll(): Promise<Category[]> {
    const rows = await invoke<unknown[]>('get_categories');
    return z.array(CategorySchema).parse(rows);
  },

  async create(dto: CreateCategoryDTO): Promise<Category> {
    const result = await invoke<{ lastInsertId: number }>('create_category', { 
      name: dto.name, 
      icon: dto.icon ?? null 
    });
    
    if (result.lastInsertId == null) {
      throw new Error('Failed to create category: missing inserted id');
    }
    
    // There isn't a get_category_by_id command natively mapped, but we can refetch all or we could have added it.
    // For simplicity we will filter from all. In a real app we'd add get_category_by_id.
    const all = await this.getAll();
    const created = all.find(c => c.id === result.lastInsertId);
    if (!created) {
      throw new Error('Failed to create category: row not found after insert');
    }
    return created;
  },

  async delete(id: number): Promise<void> {
    const txns = await invoke<{ count: number }[]>('get_category_transaction_count', { id });
    if (txns[0]?.count > 0) {
      throw new Error('Cannot delete category that has transactions');
    }
    await invoke('delete_category', { id });
  },
};
