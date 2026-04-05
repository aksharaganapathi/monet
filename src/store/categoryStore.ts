import { create } from 'zustand';
import type { Category, CreateCategoryDTO } from '../lib/types';
import { categoryRepository } from '../lib/repositories/categoryRepository';

interface CategoryState {
  categories: Category[];
  loading: boolean;
  error: string | null;
  fetchCategories: () => Promise<void>;
  addCategory: (dto: CreateCategoryDTO) => Promise<void>;
  deleteCategory: (id: number) => Promise<void>;
}

export const useCategoryStore = create<CategoryState>((set) => ({
  categories: [],
  loading: false,
  error: null,

  fetchCategories: async () => {
    set({ loading: true, error: null });
    try {
      const categories = await categoryRepository.getAll();
      set({ categories, loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  addCategory: async (dto) => {
    try {
      await categoryRepository.create(dto);
      const categories = await categoryRepository.getAll();
      set({ categories, error: null });
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  deleteCategory: async (id) => {
    try {
      await categoryRepository.delete(id);
      const categories = await categoryRepository.getAll();
      set({ categories, error: null });
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },
}));
