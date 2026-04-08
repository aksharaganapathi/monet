import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { useBudgetStore } from '../../store/budgetStore';
import { useCategoryStore } from '../../store/categoryStore';
import { useUIStore } from '../../store/uiStore';
import { formatCurrency } from '../../lib/utils';
import { getCategoryColor } from '../../lib/categories';

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.04 } },
};

const item = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0 },
};

function monthToKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function budgetProgressTone(percentUsed: number): string {
  if (percentUsed >= 100) {
    return 'var(--color-expense)';
  }
  if (percentUsed >= 75) {
    return 'var(--color-warning)';
  }
  return 'var(--color-income)';
}

export function BudgetsPage() {
  const { selectedMonth } = useUIStore();
  const { categories, fetchCategories } = useCategoryStore();
  const { budgets, progress, loading, hasLoaded, fetchBudgetProgress, upsertBudget, deleteBudget } = useBudgetStore();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [budgetAmount, setBudgetAmount] = useState('');
  const [editingBudgetId, setEditingBudgetId] = useState<number | null>(null);
  const [editingAmount, setEditingAmount] = useState('');
  const [deletingBudgetId, setDeletingBudgetId] = useState<number | null>(null);
  const [formError, setFormError] = useState('');

  const month = monthToKey(selectedMonth.year, selectedMonth.month);

  useEffect(() => {
    void fetchCategories();
  }, [fetchCategories]);

  useEffect(() => {
    void fetchBudgetProgress(month);
  }, [fetchBudgetProgress, month]);

  const availableCategories = useMemo(() => {
    const used = new Set(budgets.map((budget) => budget.category_id));
    return categories.filter((category) => !used.has(category.id));
  }, [budgets, categories]);

  const totalBudgeted = useMemo(
    () => progress.reduce((total, entry) => total + entry.budget.amount, 0),
    [progress],
  );
  const totalSpent = useMemo(
    () => progress.reduce((total, entry) => total + entry.spent, 0),
    [progress],
  );
  const onTrackCount = useMemo(
    () => progress.filter((entry) => entry.percent_used <= 100).length,
    [progress],
  );
  const overBudgetCount = useMemo(
    () => progress.filter((entry) => entry.percent_used > 100).length,
    [progress],
  );

  const submitBudget = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const amount = Number.parseFloat(budgetAmount);
    if (!selectedCategoryId || Number.isNaN(amount) || amount <= 0) {
      setFormError('Select a category and enter a valid budget amount.');
      return;
    }

    await upsertBudget(Number.parseInt(selectedCategoryId, 10), amount, month);
    setBudgetAmount('');
    setSelectedCategoryId('');
    setFormError('');
    setIsModalOpen(false);
  };

  const saveInlineBudget = async (categoryId: number) => {
    const amount = Number.parseFloat(editingAmount);
    if (Number.isNaN(amount) || amount <= 0) {
      setFormError('Enter a valid amount.');
      return;
    }
    await upsertBudget(categoryId, amount, month);
    setEditingBudgetId(null);
    setEditingAmount('');
    setFormError('');
  };

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      <motion.div variants={item} className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.03em] text-text-primary">Budgets</h1>
          <p className="mt-1 text-sm text-text-secondary">Set spending limits and track progress automatically for the month.</p>
        </div>
        <Button icon={<Plus size={16} />} onClick={() => setIsModalOpen(true)}>
          Add Budget
        </Button>
      </motion.div>

      <div className="grid grid-cols-12 gap-3">
        <motion.div variants={item} className="col-span-12 sm:col-span-6 xl:col-span-3">
          <Card className="rounded-xl p-4">
            <p className="text-[11px] uppercase tracking-[0.16em] text-text-secondary">Total Budgeted</p>
            <p className="numeric-display mt-2 text-2xl font-semibold text-text-primary">{formatCurrency(totalBudgeted)}</p>
          </Card>
        </motion.div>
        <motion.div variants={item} className="col-span-12 sm:col-span-6 xl:col-span-3">
          <Card className="rounded-xl p-4">
            <p className="text-[11px] uppercase tracking-[0.16em] text-text-secondary">Total Spent</p>
            <p className="numeric-display mt-2 text-2xl font-semibold text-text-primary">{formatCurrency(totalSpent)}</p>
          </Card>
        </motion.div>
        <motion.div variants={item} className="col-span-12 sm:col-span-6 xl:col-span-3">
          <Card className="rounded-xl p-4">
            <p className="text-[11px] uppercase tracking-[0.16em] text-text-secondary">On Track</p>
            <p className="numeric-display mt-2 text-2xl font-semibold text-income">{onTrackCount}</p>
          </Card>
        </motion.div>
        <motion.div variants={item} className="col-span-12 sm:col-span-6 xl:col-span-3">
          <Card className="rounded-xl p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] uppercase tracking-[0.16em] text-text-secondary">Over Budget</p>
              {overBudgetCount > 0 && <span className="rounded-full bg-expense-subtle px-2 py-0.5 text-xs font-semibold text-expense">{overBudgetCount}</span>}
            </div>
            <p className="numeric-display mt-2 text-2xl font-semibold text-text-primary">{overBudgetCount}</p>
          </Card>
        </motion.div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto pr-1">
        {!loading && hasLoaded && progress.length === 0 ? (
          <motion.div variants={item}>
            <EmptyState
              title="Set your first budget"
              description="Set spending limits for your categories and Monet will track your progress automatically."
              action={
                <Button icon={<Plus size={16} />} onClick={() => setIsModalOpen(true)}>
                  Set Your First Budget
                </Button>
              }
            />
          </motion.div>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {progress.map((entry) => {
              const color = getCategoryColor(entry.category.name);
              const progressWidth = Math.min(entry.percent_used, 100);
              const overflowWidth = Math.max(entry.percent_used - 100, 0);
              const isEditing = editingBudgetId === entry.budget.id;
              const isOverBudget = entry.percent_used > 100;

              return (
                <motion.div key={entry.budget.id} variants={item}>
                  <Card className={`rounded-xl p-5 ${isOverBudget ? 'border-expense' : ''}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />
                        <div>
                          <p className="text-base font-semibold text-text-primary">{entry.category.name}</p>
                          <p className="text-sm text-text-secondary">{entry.percent_used.toFixed(1)}% used</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingBudgetId(entry.budget.id);
                            setEditingAmount(entry.budget.amount.toFixed(2));
                          }}
                          className="rounded-lg p-2 text-text-tertiary transition-colors hover:bg-accent-subtle hover:text-accent"
                          aria-label={`Edit ${entry.category.name} budget`}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingBudgetId(entry.budget.id)}
                          className="rounded-lg p-2 text-text-tertiary transition-colors hover:bg-expense-subtle hover:text-expense"
                          aria-label={`Delete ${entry.category.name} budget`}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>

                    <div className="mt-5">
                      <div className="relative h-3 overflow-visible rounded-full bg-surface-muted">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${progressWidth}%`,
                            backgroundColor: budgetProgressTone(entry.percent_used),
                          }}
                        />
                        {overflowWidth > 0 && (
                          <div
                            className="absolute left-full top-0 h-full rounded-full bg-expense"
                            style={{ width: `${Math.min(overflowWidth, 40)}%` }}
                          />
                        )}
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-3">
                      <p className="text-sm text-text-primary">
                        <span className="numeric-display font-semibold">{formatCurrency(entry.spent)}</span> spent of{' '}
                        <span className="numeric-display font-semibold">{formatCurrency(entry.budget.amount)}</span> budgeted
                      </p>
                      <p className={`text-sm font-semibold ${isOverBudget ? 'text-expense' : 'text-text-secondary'}`}>
                        {isOverBudget ? `${formatCurrency(Math.abs(entry.remaining))} over` : `${formatCurrency(entry.remaining)} left`}
                      </p>
                    </div>

                    {isEditing && (
                      <div className="mt-4 flex items-end gap-2">
                        <Input
                          label="Edit amount"
                          type="number"
                          step="0.01"
                          value={editingAmount}
                          onChange={(event) => setEditingAmount(event.target.value)}
                        />
                        <Button onClick={() => void saveInlineBudget(entry.category.id)}>Save</Button>
                      </div>
                    )}
                  </Card>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Set Budget" size="sm">
        <form onSubmit={submitBudget} className="space-y-4">
          <Select
            label="Category"
            value={selectedCategoryId}
            onChange={(event) => setSelectedCategoryId(event.target.value)}
            options={availableCategories.map((category) => ({ value: category.id, label: category.name }))}
            placeholder="Choose a category"
          />
          <Input
            label="Amount"
            type="number"
            step="0.01"
            value={budgetAmount}
            onChange={(event) => setBudgetAmount(event.target.value)}
            placeholder="0.00"
            error={formError}
          />
          <div className="flex justify-end gap-3">
            <Button variant="secondary" type="button" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Set Budget</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={deletingBudgetId != null}
        onClose={() => setDeletingBudgetId(null)}
        onConfirm={async () => {
          if (deletingBudgetId == null) return;
          await deleteBudget(deletingBudgetId, month);
          setDeletingBudgetId(null);
        }}
        title="Delete Budget"
        description="Delete this budget? Monet will stop tracking this category against a spending cap."
        confirmLabel="Delete Budget"
      />
    </motion.div>
  );
}
