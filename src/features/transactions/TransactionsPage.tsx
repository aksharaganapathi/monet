import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowDownRight,
  ArrowUpRight,
  Flag,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { getCategoryColor } from '../../lib/categories';
import { detectRecurring } from '../../lib/finance';
import { settingsRepository } from '../../lib/repositories/settingsRepository';
import { formatCurrency, formatDate, getMonthDateRange } from '../../lib/utils';
import { useAccountStore } from '../../store/accountStore';
import { useCategoryStore } from '../../store/categoryStore';
import { useTransactionStore } from '../../store/transactionStore';
import { useUIStore } from '../../store/uiStore';

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.03 } },
};

const item = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0 },
};

function resolveRange(
  preset: 'thisMonth' | 'lastMonth' | 'last3Months' | 'custom',
  selectedMonth: { year: number; month: number },
  start: string | null,
  end: string | null,
) {
  if (preset === 'custom' && start && end) {
    return { start, end };
  }

  if (preset === 'lastMonth') {
    const date = new Date(selectedMonth.year, selectedMonth.month - 2, 1);
    return getMonthDateRange(date.getFullYear(), date.getMonth() + 1);
  }

  if (preset === 'last3Months') {
    const startDate = new Date(selectedMonth.year, selectedMonth.month - 3, 1);
    const endDate = new Date(selectedMonth.year, selectedMonth.month, 0);
    return {
      start: `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-01`,
      end: `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(
        endDate.getDate(),
      ).padStart(2, '0')}`,
    };
  }

  return getMonthDateRange(selectedMonth.year, selectedMonth.month);
}

function daysInRange(start: string, end: string) {
  const left = new Date(`${start}T00:00:00`);
  const right = new Date(`${end}T00:00:00`);
  return Math.max(1, Math.round((right.getTime() - left.getTime()) / 86_400_000) + 1);
}

export function TransactionsPage() {
  const {
    transactions,
    hasLoaded,
    fetchTransactions,
    deleteTransaction,
    setTransactionFlagged,
  } = useTransactionStore();
  const { hasLoaded: accountsLoaded, fetchAccounts } = useAccountStore();
  const { fetchCategories } = useCategoryStore();
  const {
    openTransactionForm,
    openTransactionFormForEdit,
    setActivePage,
    selectedMonth,
    transactionFilters,
    setTransactionSearch,
    setTransactionTypeFilter,
    setTransactionDatePreset,
    setTransactionCustomDateRange,
    setTransactionCategoryFilter,
    clearTransactionFilters,
  } = useUIStore();
  const [deletingTransactionId, setDeletingTransactionId] = useState<number | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [syncError, setSyncError] = useState('');

  useEffect(() => {
    if (!hasLoaded) void fetchTransactions();
    if (!accountsLoaded) void fetchAccounts();
    void fetchCategories();
  }, [accountsLoaded, fetchAccounts, fetchCategories, fetchTransactions, hasLoaded]);

  const syncInbox = async () => {
    setSyncBusy(true);
    setSyncMessage('');
    setSyncError('');

    try {
      const result = await settingsRepository.importSyncQueue();
      if (result.imported > 0) {
        await Promise.all([fetchTransactions(true), fetchAccounts(true)]);
        setSyncMessage(
          `Imported ${result.imported} transaction${result.imported === 1 ? '' : 's'} from sync queue.`,
        );
      } else {
        setSyncMessage('No new transactions in the sync queue.');
      }
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : 'Unable to import sync queue.');
    } finally {
      setSyncBusy(false);
    }
  };

  const recurringPatterns = useMemo(() => detectRecurring(transactions), [transactions]);

  const recurringTransactionIds = useMemo(
    () => new Set(recurringPatterns.flatMap((pattern) => pattern.transaction_ids)),
    [recurringPatterns],
  );

  const recurringPatternMap = useMemo(() => {
    const map = new Map<number, string>();
    recurringPatterns.forEach((pattern) => {
      pattern.transaction_ids.forEach((id) => map.set(id, pattern.frequency));
    });
    return map;
  }, [recurringPatterns]);

  const range = useMemo(
    () =>
      resolveRange(
        transactionFilters.datePreset,
        selectedMonth,
        transactionFilters.customStartDate,
        transactionFilters.customEndDate,
      ),
    [
      selectedMonth,
      transactionFilters.customEndDate,
      transactionFilters.customStartDate,
      transactionFilters.datePreset,
    ],
  );

  const filtered = useMemo(() => {
    const needle = transactionFilters.search.trim().toLowerCase();

    return transactions.filter((transaction) => {
      if (transaction.date < range.start || transaction.date > range.end) return false;
      if (
        transactionFilters.categoryName &&
        transaction.category_name !== transactionFilters.categoryName
      ) {
        return false;
      }
      if (transactionFilters.type === 'income' && transaction.amount <= 0) return false;
      if (transactionFilters.type === 'expense' && transaction.amount >= 0) return false;
      if (transactionFilters.type === 'flagged' && !transaction.flagged) return false;
      if (
        transactionFilters.type === 'recurring' &&
        !recurringTransactionIds.has(transaction.id)
      ) {
        return false;
      }
      if (!needle) return true;

      const searchable = [
        transaction.note ?? '',
        transaction.merchant ?? '',
        transaction.category_name,
        transaction.account_name,
        formatCurrency(transaction.amount),
        formatDate(transaction.date),
        new Date(`${transaction.date}T00:00:00`).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        }),
      ]
        .join(' ')
        .toLowerCase();

      return searchable.includes(needle);
    });
  }, [
    range.end,
    range.start,
    recurringTransactionIds,
    transactionFilters.categoryName,
    transactionFilters.search,
    transactionFilters.type,
    transactions,
  ]);

  const grouped = useMemo(
    () =>
      filtered.reduce<Record<string, typeof filtered>>((accumulator, transaction) => {
        if (!accumulator[transaction.date]) {
          accumulator[transaction.date] = [];
        }
        accumulator[transaction.date].push(transaction);
        return accumulator;
      }, {}),
    [filtered],
  );

  const incomeTotal = useMemo(
    () =>
      filtered
        .filter((transaction) => transaction.amount > 0)
        .reduce((sum, transaction) => sum + transaction.amount, 0),
    [filtered],
  );

  const expenseTotal = useMemo(
    () =>
      filtered
        .filter((transaction) => transaction.amount < 0)
        .reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0),
    [filtered],
  );

  const avgPerDay = expenseTotal / daysInRange(range.start, range.end);

  const filtersActive =
    transactionFilters.search !== '' ||
    transactionFilters.type !== 'all' ||
    transactionFilters.categoryName != null ||
    transactionFilters.datePreset !== 'thisMonth';

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="flex h-full min-h-0 flex-col gap-4 overflow-hidden"
    >
      <motion.div variants={item} className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.03em] text-text-primary">
            Transactions
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Searchable cash movement, flagged reviews, and recurring signals in one
            place.
          </p>
          {syncMessage && <p className="mt-1 text-xs text-income">{syncMessage}</p>}
          {syncError && <p className="mt-1 text-xs text-expense">{syncError}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            icon={<RefreshCw size={16} />}
            onClick={syncInbox}
            disabled={syncBusy}
          >
            {syncBusy ? 'Syncing...' : 'Sync Inbox'}
          </Button>
          <Button variant="secondary" onClick={() => setActivePage('categories')}>
            Manage Categories
          </Button>
          <Button icon={<Plus size={16} />} onClick={openTransactionForm}>
            Add Transaction
          </Button>
        </div>
      </motion.div>

      <motion.div variants={item}>
        <Card className="rounded-xl p-4">
          <div className="grid gap-3 xl:grid-cols-[1.5fr_auto_auto]">
            <div className="relative">
              <Search
                size={16}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-tertiary"
              />
              <input
                value={transactionFilters.search}
                onChange={(event) => setTransactionSearch(event.target.value)}
                placeholder="Search note, category, account, amount, or date"
                className="w-full rounded-lg border border-border bg-surface-elevated py-3 pl-10 pr-4 text-sm text-text-primary outline-none transition-all focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            </div>

            <div className="surface-card flex flex-wrap items-center gap-1 rounded-xl p-1">
              {(['all', 'income', 'expense', 'recurring', 'flagged'] as const).map(
                (type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setTransactionTypeFilter(type)}
                    className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                      transactionFilters.type === type
                        ? 'bg-accent text-white'
                        : 'text-text-secondary hover:bg-accent-subtle hover:text-text-primary'
                    }`}
                  >
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </button>
                ),
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <select
                value={transactionFilters.datePreset}
                onChange={(event) =>
                  setTransactionDatePreset(
                    event.target.value as typeof transactionFilters.datePreset,
                  )
                }
                className="rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-text-primary"
              >
                <option value="thisMonth">This month</option>
                <option value="lastMonth">Last month</option>
                <option value="last3Months">Last 3 months</option>
                <option value="custom">Custom range</option>
              </select>

              {transactionFilters.datePreset === 'custom' && (
                <>
                  <input
                    type="date"
                    value={transactionFilters.customStartDate ?? ''}
                    onChange={(event) =>
                      setTransactionCustomDateRange(
                        event.target.value || null,
                        transactionFilters.customEndDate,
                      )
                    }
                    className="rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm"
                  />
                  <input
                    type="date"
                    value={transactionFilters.customEndDate ?? ''}
                    onChange={(event) =>
                      setTransactionCustomDateRange(
                        transactionFilters.customStartDate,
                        event.target.value || null,
                      )
                    }
                    className="rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm"
                  />
                </>
              )}
            </div>
          </div>

          {transactionFilters.categoryName && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setTransactionCategoryFilter(null)}
                className="rounded-full bg-accent-subtle px-3 py-1 text-xs font-semibold text-accent"
              >
                {transactionFilters.categoryName} ×
              </button>
            </div>
          )}
        </Card>
      </motion.div>

      <div className="grid grid-cols-12 gap-3">
        <motion.div variants={item} className="col-span-6 md:col-span-3">
          <Card className="rounded-xl p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-secondary">
                {filtersActive ? 'Filtered' : 'Shown'}
              </p>
              {filtersActive && (
                <button
                  type="button"
                  onClick={clearTransactionFilters}
                  className="text-xs text-accent"
                >
                  Clear
                </button>
              )}
            </div>
            <p className="numeric-display mt-2 text-2xl font-semibold text-text-primary">
              {filtered.length}
            </p>
          </Card>
        </motion.div>

        <motion.div variants={item} className="col-span-6 md:col-span-3">
          <Card className="rounded-xl p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-secondary">
              Income
            </p>
            <p className="numeric-display mt-2 text-xl font-semibold text-income">
              {formatCurrency(incomeTotal)}
            </p>
          </Card>
        </motion.div>

        <motion.div variants={item} className="col-span-6 md:col-span-3">
          <Card className="rounded-xl p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-secondary">
              Expense
            </p>
            <p className="numeric-display mt-2 text-xl font-semibold text-expense">
              {formatCurrency(expenseTotal)}
            </p>
          </Card>
        </motion.div>

        <motion.div variants={item} className="col-span-6 md:col-span-3">
          <Card className="rounded-xl p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-secondary">
              Avg per day
            </p>
            <p className="numeric-display mt-2 text-xl font-semibold text-text-primary">
              {formatCurrency(avgPerDay)}
            </p>
          </Card>
        </motion.div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto pr-1">
        {filtered.length === 0 ? (
          <motion.div variants={item}>
            <EmptyState
              title={transactions.length === 0 ? 'No transactions yet' : 'No matching transactions'}
              description={
                transactions.length === 0
                  ? 'Add your first transaction to start tracking.'
                  : 'Try adjusting the search or filters.'
              }
              action={
                transactions.length === 0 ? (
                  <Button icon={<Plus size={16} />} onClick={openTransactionForm}>
                    Add Transaction
                  </Button>
                ) : undefined
              }
            />
          </motion.div>
        ) : (
          <div className="space-y-5">
            {Object.entries(grouped).map(([date, txns]) => (
              <motion.div key={date} variants={item}>
                <div className="mb-2 flex items-center justify-between px-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-tertiary">
                    {formatDate(date)}
                  </p>
                  <p className="text-xs text-text-secondary">
                    {txns.length} item{txns.length !== 1 ? 's' : ''}
                  </p>
                </div>

                <Card className="overflow-hidden rounded-xl !p-0">
                  <div className="divide-y divide-border-subtle">
                    {txns.map((transaction) => (
                      <div
                        key={transaction.id}
                        className="group flex items-center justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-surface-muted"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <div
                            className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                              transaction.amount >= 0
                                ? 'bg-income-subtle text-income'
                                : 'bg-expense-subtle text-expense'
                            }`}
                          >
                            {transaction.amount >= 0 ? (
                              <ArrowUpRight size={16} />
                            ) : (
                              <ArrowDownRight size={16} />
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className="h-2 w-2 rounded-sm"
                                style={{
                                  backgroundColor: getCategoryColor(transaction.category_name),
                                }}
                              />
                              <p className="truncate text-sm font-semibold text-text-primary">
                                {transaction.category_name}
                              </p>
                              <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-text-secondary">
                                {transaction.account_name}
                              </span>
                              {recurringTransactionIds.has(transaction.id) && (
                                <span className="rounded-full bg-info-subtle px-2 py-0.5 text-[11px] font-semibold text-info">
                                  ↻ {recurringPatternMap.get(transaction.id)}
                                </span>
                              )}
                              {transaction.flagged && (
                                <span className="rounded-full bg-warning-subtle px-2 py-0.5 text-[11px] font-semibold text-warning">
                                  Flagged
                                </span>
                              )}
                            </div>

                            {transaction.note && (
                              <p className="mt-1 truncate text-xs text-text-secondary">
                                {transaction.note}
                              </p>
                            )}

                            {transaction.merchant && (
                              <p className="mt-0.5 truncate text-[11px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
                                Merchant: {transaction.merchant}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          <p
                            className={`numeric-display min-w-[110px] text-right text-sm font-semibold ${
                              transaction.amount >= 0 ? 'text-income' : 'text-expense'
                            }`}
                          >
                            {transaction.amount >= 0 ? '+' : '−'}
                            {formatCurrency(Math.abs(transaction.amount))}
                          </p>
                          <button
                            type="button"
                            onClick={() =>
                              void setTransactionFlagged(
                                transaction.id,
                                !transaction.flagged,
                              )
                            }
                            className={`rounded-lg p-2 transition-colors ${
                              transaction.flagged
                                ? 'text-warning hover:bg-warning-subtle'
                                : 'text-text-tertiary hover:bg-surface-muted hover:text-text-primary'
                            }`}
                            aria-label="Flag transaction"
                          >
                            <Flag size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => openTransactionFormForEdit(transaction.id)}
                            className="rounded-lg p-2 text-text-tertiary transition-colors hover:bg-accent-subtle hover:text-accent"
                            aria-label="Edit transaction"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingTransactionId(transaction.id)}
                            className="rounded-lg p-2 text-text-tertiary transition-colors hover:bg-expense-subtle hover:text-expense"
                            aria-label="Delete transaction"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={deletingTransactionId != null}
        onClose={() => setDeletingTransactionId(null)}
        onConfirm={async () => {
          if (deletingTransactionId == null) return;
          await deleteTransaction(deletingTransactionId);
          setDeletingTransactionId(null);
        }}
        title="Delete Transaction"
        description="Delete this transaction? Your account balance will be updated automatically."
        confirmLabel="Delete Transaction"
      />
    </motion.div>
  );
}
