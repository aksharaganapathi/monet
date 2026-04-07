import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowDownRight, ArrowUpRight, Pencil, Plus, Search, SlidersHorizontal, Trash2 } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useTransactionStore } from '../../store/transactionStore';
import { useAccountStore } from '../../store/accountStore';
import { useCategoryStore } from '../../store/categoryStore';
import { useUIStore } from '../../store/uiStore';
import { formatCurrency, formatDate } from '../../lib/utils';

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.03 } },
};
const item = { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } };

export function TransactionsPage() {
  const { transactions, hasLoaded, fetchTransactions, deleteTransaction } = useTransactionStore();
  const { hasLoaded: accountsLoaded, fetchAccounts } = useAccountStore();
  const { fetchCategories } = useCategoryStore();
  const { openTransactionForm, openTransactionFormForEdit, setActivePage } = useUIStore();

  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  const [deletingTransactionId, setDeletingTransactionId] = useState<number | null>(null);

  useEffect(() => {
    if (!hasLoaded) fetchTransactions();
    if (!accountsLoaded) fetchAccounts();
    fetchCategories();
  }, [hasLoaded, accountsLoaded, fetchTransactions, fetchAccounts, fetchCategories]);

  const filtered = useMemo(() => transactions.filter((txn) => {
    const needle = search.toLowerCase();
    const matchesSearch =
      search === '' ||
      txn.category_name.toLowerCase().includes(needle) ||
      txn.account_name.toLowerCase().includes(needle) ||
      (txn.note && txn.note.toLowerCase().includes(needle));

    const matchesFilter =
      filterType === 'all' ||
      (filterType === 'income' && txn.amount > 0) ||
      (filterType === 'expense' && txn.amount < 0);

    return matchesSearch && matchesFilter;
  }), [transactions, search, filterType]);

  const grouped = useMemo(() => filtered.reduce<Record<string, typeof filtered>>((acc, txn) => {
    if (!acc[txn.date]) acc[txn.date] = [];
    acc[txn.date].push(txn);
    return acc;
  }, {}), [filtered]);

  const incomeTotal = useMemo(() => filtered.filter((txn) => txn.amount > 0).reduce((sum, txn) => sum + txn.amount, 0), [filtered]);
  const expenseTotal = useMemo(() => filtered.filter((txn) => txn.amount < 0).reduce((sum, txn) => sum + Math.abs(txn.amount), 0), [filtered]);

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      <motion.div variants={item} className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.03em] text-text-primary">Transactions</h1>
          <p className="mt-1 text-sm text-text-secondary">Searchable cash movement, with cleaner scanning and faster editing.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setActivePage('categories')}>
            Manage Categories
          </Button>
          <Button icon={<Plus size={16} />} onClick={openTransactionForm}>
            Add Transaction
          </Button>
        </div>
      </motion.div>

      <div className="grid grid-cols-12 gap-4">
        <motion.div variants={item} className="col-span-12 lg:col-span-6">
          <Card className="rounded-[24px] p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search category, account, or note"
                  className="w-full rounded-2xl border border-white/60 bg-white/70 py-3 pl-10 pr-4 text-sm text-text-primary placeholder:text-text-tertiary outline-none transition-all focus:border-accent focus:ring-2 focus:ring-accent/20"
                  aria-label="Search transactions"
                />
              </div>

              <div className="flex items-center gap-1 rounded-2xl border border-white/60 bg-white/62 p-1">
                {(['all', 'income', 'expense'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => setFilterType(type)}
                    className={`rounded-xl px-3 py-2 text-xs font-semibold transition-all ${filterType === type ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'}`}
                  >
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div variants={item} className="col-span-12 sm:col-span-4 lg:col-span-2">
          <Card className="rounded-[24px] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-secondary">Shown</p>
            <p className="mt-2 text-2xl font-semibold numeric-display text-text-primary">{filtered.length}</p>
          </Card>
        </motion.div>

        <motion.div variants={item} className="col-span-12 sm:col-span-4 lg:col-span-2">
          <Card className="rounded-[24px] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-secondary">Income</p>
            <p className="mt-2 text-xl font-semibold numeric-display text-income">{formatCurrency(incomeTotal)}</p>
          </Card>
        </motion.div>

        <motion.div variants={item} className="col-span-12 sm:col-span-4 lg:col-span-2">
          <Card className="rounded-[24px] p-4">
            <div className="flex items-center gap-2">
              <SlidersHorizontal size={14} className="text-text-secondary" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-secondary">Expense</p>
            </div>
            <p className="mt-2 text-xl font-semibold numeric-display text-expense">{formatCurrency(expenseTotal)}</p>
          </Card>
        </motion.div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto pr-1">
        {filtered.length === 0 ? (
          <motion.div variants={item}>
            <EmptyState
              icon={<ArrowUpRight size={24} />}
              title={transactions.length === 0 ? 'No transactions yet' : 'No matching transactions'}
              description={transactions.length === 0 ? 'Add your first transaction to start reading your cash flow.' : 'Try changing the search or filter.'}
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
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-tertiary">{formatDate(date)}</p>
                  <p className="text-xs text-text-secondary">{txns.length} item{txns.length !== 1 ? 's' : ''}</p>
                </div>
                <Card className="overflow-hidden rounded-[24px] !p-0">
                  <div className="divide-y divide-border-subtle">
                    {txns.map((txn) => (
                      <div key={txn.id} className="group flex items-center justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-white/55">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${txn.amount >= 0 ? 'bg-income-subtle text-income' : 'bg-expense-subtle text-expense'}`}>
                            {txn.amount >= 0 ? <ArrowUpRight size={18} /> : <ArrowDownRight size={18} />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-semibold text-text-primary">{txn.category_name}</p>
                              <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] text-text-secondary">{txn.account_name}</span>
                            </div>
                            {txn.note && <p className="mt-1 truncate text-xs text-text-secondary">{txn.note}</p>}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <p className={`text-sm font-semibold numeric-display ${txn.amount >= 0 ? 'text-income' : 'text-expense'}`}>
                            {txn.amount >= 0 ? '+' : ''}{formatCurrency(txn.amount)}
                          </p>
                          <button
                            onClick={() => openTransactionFormForEdit(txn.id)}
                            className="rounded-xl p-2 text-text-tertiary transition-colors hover:bg-accent-subtle hover:text-accent"
                            aria-label="Edit transaction"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            onClick={() => setDeletingTransactionId(txn.id)}
                            className="rounded-xl p-2 text-text-tertiary transition-colors hover:bg-expense-subtle hover:text-expense"
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
