import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, ArrowUpRight, ArrowDownRight, Trash2, Search } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
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
  const { transactions, fetchTransactions, deleteTransaction } = useTransactionStore();
  const { fetchAccounts } = useAccountStore();
  const { fetchCategories } = useCategoryStore();
  const { openTransactionForm } = useUIStore();

  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');

  useEffect(() => {
    fetchTransactions();
    fetchAccounts();
    fetchCategories();
  }, []);

  const filtered = transactions.filter((txn) => {
    const matchesSearch =
      search === '' ||
      txn.category_name.toLowerCase().includes(search.toLowerCase()) ||
      txn.account_name.toLowerCase().includes(search.toLowerCase()) ||
      (txn.note && txn.note.toLowerCase().includes(search.toLowerCase()));

    const matchesFilter =
      filterType === 'all' ||
      (filterType === 'income' && txn.amount > 0) ||
      (filterType === 'expense' && txn.amount < 0);

    return matchesSearch && matchesFilter;
  });

  const handleDelete = async (id: number) => {
    if (confirm('Delete this transaction? The account balance will be adjusted.')) {
      await deleteTransaction(id);
    }
  };

  // Group by date
  const grouped = filtered.reduce<Record<string, typeof filtered>>((acc, txn) => {
    if (!acc[txn.date]) acc[txn.date] = [];
    acc[txn.date].push(txn);
    return acc;
  }, {});

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
      {/* Header */}
      <motion.div variants={item} className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Transactions</h1>
          <p className="text-sm text-text-secondary mt-1">
            {transactions.length} total transaction{transactions.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button icon={<Plus size={16} />} onClick={openTransactionForm}>
          Add Transaction
        </Button>
      </motion.div>

      {/* Search & Filters */}
      <motion.div variants={item} className="flex gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search transactions..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-surface-elevated text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
            aria-label="Search transactions"
          />
        </div>
        <div className="flex gap-1 p-1 bg-surface-elevated border border-border rounded-xl">
          {(['all', 'income', 'expense'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                filterType === type
                  ? 'bg-accent text-white'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>
      </motion.div>

      {/* Transaction List */}
      {filtered.length === 0 ? (
        <motion.div variants={item}>
          <EmptyState
            icon={<ArrowUpRight size={24} />}
            title={transactions.length === 0 ? 'No transactions yet' : 'No matching transactions'}
            description={
              transactions.length === 0
                ? 'Add your first transaction to start tracking your money.'
                : 'Try adjusting your search or filters.'
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
        <div className="space-y-6">
          {Object.entries(grouped).map(([date, txns]) => (
            <motion.div key={date} variants={item}>
              <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2 px-1">
                {formatDate(date)}
              </p>
              <Card className="!p-0 divide-y divide-border-subtle">
                {txns.map((txn) => (
                  <div
                    key={txn.id}
                    className="group flex items-center justify-between px-5 py-3.5 hover:bg-accent-subtle/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                        txn.amount >= 0 ? 'bg-income-subtle' : 'bg-expense-subtle'
                      }`}>
                        {txn.amount >= 0 ? (
                          <ArrowUpRight size={16} className="text-income" />
                        ) : (
                          <ArrowDownRight size={16} className="text-expense" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-text-primary truncate">
                            {txn.category_name}
                          </p>
                          {txn.note && (
                            <span className="text-xs text-text-tertiary truncate hidden sm:inline">
                              — {txn.note}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-text-tertiary">{txn.account_name}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                      <p className={`text-sm font-semibold ${
                        txn.amount >= 0 ? 'text-income' : 'text-expense'
                      }`}>
                        {txn.amount >= 0 ? '+' : ''}{formatCurrency(txn.amount)}
                      </p>
                      <button
                        onClick={() => handleDelete(txn.id)}
                        className="p-1.5 rounded-lg text-text-tertiary hover:text-expense hover:bg-expense-subtle transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
                        aria-label="Delete transaction"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
