import type { Category } from './types';

const CATEGORY_COLOR_MAP: Record<string, string> = {
  savings: 'var(--color-sankey-savings)',
  healthcare: 'var(--color-sankey-healthcare)',
  dining: 'var(--color-sankey-dining)',
  transport: 'var(--color-sankey-transport)',
  shopping: 'var(--color-sankey-shopping)',
  groceries: 'var(--color-sankey-dining)',
  rent: 'var(--color-gold-border)',
  utilities: 'var(--color-warning)',
  entertainment: 'var(--color-info)',
  travel: 'var(--color-info)',
  salary: 'var(--color-income)',
  freelance: 'var(--color-income)',
  investment: 'var(--color-info)',
  income: 'var(--color-income)',
  transfers: 'var(--color-text-tertiary)',
  transfer: 'var(--color-text-tertiary)',
  other: 'var(--color-sankey-other)',
};

const INCOME_CATEGORY_NAMES = new Set([
  'salary',
  'freelance',
  'investment',
  'income',
]);

export function getCategoryColor(name: string): string {
  return CATEGORY_COLOR_MAP[name.trim().toLowerCase()] ?? 'var(--color-sankey-other)';
}

export function isIncomeCategoryName(name: string): boolean {
  return INCOME_CATEGORY_NAMES.has(name.trim().toLowerCase());
}

export function splitCategoriesByType(categories: Category[]): {
  incomeCategories: Category[];
  expenseCategories: Category[];
} {
  const incomeCategories = categories.filter((category) => isIncomeCategoryName(category.name));
  const expenseCategories = categories.filter((category) => !isIncomeCategoryName(category.name));

  return { incomeCategories, expenseCategories };
}
