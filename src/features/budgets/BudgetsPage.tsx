import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Pencil, Plus, Trash2 } from 'lucide-react';
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
import { formatCurrency, getMonthName } from '../../lib/utils';
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
  if (percentUsed >= 100) return 'var(--color-expense)';
  if (percentUsed >= 75) return 'var(--color-warning)';
  return 'var(--color-income)';
}

export function BudgetsPage() {
  const { selectedMonth } = useUIStore();
  const { categories, fetchCategories } = useCategoryStore();
  const { budgets, progress, loading, hasLoaded, fetchBudgetProgress, upsertBudget, deleteBudget } =
    useBudgetStore();
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
  const totalSpent = useMemo(() => progress.reduce((total, entry) => total + entry.spent, 0), [progress]);
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
    <motion.div variants={container} initial="hidden" animate="show" className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1">
      <motion.div variants={item}>
        <Card className="overflow-hidden p-0">
          <div className="bg-[linear-gradient(135deg,rgba(255,240,231,0.95),rgba(255,255,255,0.94)_58%,rgba(232,247,239,0.88))] p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
                  Budgets
                </p>
                <h1 className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-text-primary">
                  Spending guardrails
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">
                  Set category caps, watch progress automatically, and catch overspend before the month closes.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <div className="rounded-full bg-white/90 px-3 py-1.5 text-xs font-semibold text-text-secondary shadow-sm">
                  {getMonthName(selectedMonth.month)} {selectedMonth.year}
                </div>
                <Button icon={<Plus size={16} />} onClick={() => setIsModalOpen(true)}>
                  Add Budget
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-px bg-border-subtle md:grid-cols-4">
            <div className="bg-white/70 px-6 py-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-secondary">
                Total budgeted
              </p>
              <p className="mt-2 text-2xl font-semibold text-text-primary numeric-display">
                {formatCurrency(totalBudgeted)}
              </p>
            </div>
            <div className="bg-white/70 px-6 py-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-secondary">
                Total spent
              </p>
              <p className="mt-2 text-2xl font-semibold text-text-primary numeric-display">
                {formatCurrency(totalSpent)}
              </p>
            </div>
            <div className="bg-white/70 px-6 py-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-secondary">
                On track
              </p>
              <p className="mt-2 text-2xl font-semibold text-income numeric-display">{onTrackCount}</p>
            </div>
            <div className="bg-white/70 px-6 py-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-secondary">
                Over budget
              </p>
              <p className="mt-2 text-2xl font-semibold text-expense numeric-display">{overBudgetCount}</p>
            </div>
          </div>
        </Card>
      </motion.div>

      <div className="min-h-0 flex-1">
        {!loading && hasLoaded && progress.length === 0 ? (
          <motion.div variants={item}>
            <EmptyState
              title="Set your first budget"
              description="Create a monthly cap for the categories you care about most and Monet will keep the rest updated automatically."
              action={
                <Button icon={<Plus size={16} />} onClick={() => setIsModalOpen(true)}>
                  Set your first budget
                </Button>
              }
            />
          </motion.div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {progress.map((entry) => {
              const color = getCategoryColor(entry.category.name);
              const progressWidth = Math.min(entry.percent_used, 100);
              const overflowWidth = Math.max(entry.percent_used - 100, 0);
              const isEditing = editingBudgetId === entry.budget.id;
              const isOverBudget = entry.percent_used > 100;

              return (
                <motion.div key={entry.budget.id} variants={item}>
                  <Card className={`p-6 ${isOverBudget ? 'border-expense/40' : ''}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="h-12 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                        <div className="min-w-0">
                          <p className="truncate text-lg font-semibold text-text-primary">{entry.category.name}</p>
                          <p className="mt-1 text-sm text-text-secondary">{entry.percent_used.toFixed(1)}% of budget used</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingBudgetId(entry.budget.id);
                            setEditingAmount(entry.budget.amount.toFixed(2));
                          }}
                          className="rounded-xl p-2 text-text-tertiary transition-colors hover:bg-accent-subtle hover:text-accent"
                          aria-label={`Edit ${entry.category.name} budget`}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingBudgetId(entry.budget.id)}
                          className="rounded-xl p-2 text-text-tertiary transition-colors hover:bg-expense-subtle hover:text-expense"
                          aria-label={`Delete ${entry.category.name} budget`}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>

                    <div className="mt-6 rounded-[24px] bg-surface-muted px-5 py-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-text-secondary">
                            Budgeted
                          </p>
                          <p className="mt-2 text-2xl font-semibold text-text-primary numeric-display">
                            {formatCurrency(entry.budget.amount)}
                          </p>
                        </div>
                        <div className={`rounded-full px-3 py-1.5 text-xs font-semibold ${isOverBudget ? 'bg-expense-subtle text-expense' : 'bg-income-subtle text-income'}`}>
                          {isOverBudget
                            ? `${formatCurrency(Math.abs(entry.remaining))} over`
                            : `${formatCurrency(entry.remaining)} left`}
                        </div>
                      </div>

                      <div className="mt-5">
                        <div className="relative h-3 overflow-visible rounded-full bg-white">
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
                              style={{ width: `${Math.min(overflowWidth, 45)}%` }}
                            />
                          )}
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
                        <p className="text-text-secondary">
                          Spent <span className="font-semibold text-text-primary numeric-display">{formatCurrency(entry.spent)}</span>
                        </p>
                        <p className="text-text-secondary">
                          Remaining <span className="font-semibold text-text-primary numeric-display">{formatCurrency(entry.remaining)}</span>
                        </p>
                      </div>
                    </div>

                    {isEditing && (
                      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                        <div className="flex-1">
                          <Input
                            label="Edit amount"
                            type="number"
                            step="0.01"
                            value={editingAmount}
                            onChange={(event) => setEditingAmount(event.target.value)}
                          />
                        </div>
                        <Button onClick={() => void saveInlineBudget(entry.category.id)}>Save changes</Button>
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
