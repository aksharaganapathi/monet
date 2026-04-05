import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, Wallet, ArrowUpRight, ArrowDownRight, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { BankIcon } from '../../components/ui/BankIcon';
import { useUIStore } from '../../store/uiStore';
import { useAccountStore } from '../../store/accountStore';
import { useTransactionStore } from '../../store/transactionStore';
import { useCategoryStore } from '../../store/categoryStore';
import { formatCurrency, formatDateShort, getCurrentMonth, getMonthName } from '../../lib/utils';

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.04 },
  },
};

const item = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0 },
};

export function DashboardPage() {
  const { accounts, totalBalance, netWorthTrend, fetchAccounts, fetchNetWorthTrend } = useAccountStore();
  const { transactions, monthlySpending, monthlyTotal, predictedEndOfMonthSpend, fetchTransactions, fetchMonthlySpending } = useTransactionStore();
  const { fetchCategories } = useCategoryStore();
  const { openTransactionForm } = useUIStore();

  const [targetDate, setTargetDate] = useState(getCurrentMonth());

  useEffect(() => {
    fetchAccounts();
    fetchTransactions();
    fetchCategories();
  }, []);

  // Fetch trend once accounts + transactions are loaded
  useEffect(() => {
    fetchNetWorthTrend();
  }, [totalBalance, transactions.length]);

  useEffect(() => {
    fetchMonthlySpending(targetDate.year, targetDate.month);
  }, [targetDate.year, targetDate.month]);

  const recentTransactions = transactions
    .filter(t => t.date.startsWith(`${targetDate.year}-${String(targetDate.month).padStart(2, '0')}`))
    .slice(0, 8);

  const prevMonth = () => {
    setTargetDate(prev => prev.month === 1 ? { year: prev.year - 1, month: 12 } : { year: prev.year, month: prev.month - 1 });
  };

  const nextMonth = () => {
    setTargetDate(prev => prev.month === 12 ? { year: prev.year + 1, month: 1 } : { year: prev.year, month: prev.month + 1 });
  };

  // Calculate monthly income
  const monthlyIncome = transactions
    .filter((t) => {
      const d = t.date;
      return d.startsWith(`${targetDate.year}-${String(targetDate.month).padStart(2, '0')}`) && t.amount > 0;
    })
    .reduce((sum, t) => sum + t.amount, 0);

  // Prep sparkline data
  const sparkData = netWorthTrend.length > 0
    ? netWorthTrend.slice(-30) // Last 30 data points
    : [{ date: 'now', value: totalBalance }];

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-5">
      {/* Header — compact desktop size */}
      <motion.div variants={item} className="flex justify-between items-center">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Dashboard</h1>
          <p className="text-xs text-text-secondary mt-0.5">Overview & insights</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 bg-white p-1 rounded-lg border border-border">
            <button onClick={prevMonth} className="p-1 hover:bg-black/5 rounded transition-colors cursor-pointer text-text-secondary hover:text-text-primary">
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs font-semibold min-w-20 text-center">
              {getMonthName(targetDate.month)} {targetDate.year}
            </span>
            <button onClick={nextMonth} className="p-1 hover:bg-black/5 rounded transition-colors cursor-pointer text-text-secondary hover:text-text-primary">
              <ChevronRight size={14} />
            </button>
          </div>
          <Button icon={<Plus size={14} />} onClick={openTransactionForm} className="hidden sm:flex text-xs">
            Add Transaction
          </Button>
        </div>
      </motion.div>

      {/* ======== 3-Column Grid ======== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* ─── Col 1-2: Main Overview ─── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Net Worth — Condensed Hero */}
          <motion.div variants={item}>
            <Card>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-5 min-w-0">
                  <div>
                    <p className="text-xs font-medium text-text-secondary uppercase tracking-wider">Net Worth</p>
                    <p className={`text-3xl font-bold mt-1 tracking-tight ${totalBalance >= 0 ? 'text-text-primary' : 'text-expense'}`}>
                      {formatCurrency(totalBalance)}
                    </p>
                  </div>
                  <div className="h-10 w-px bg-border-subtle" />
                  <div className="flex items-center gap-5 text-xs text-text-secondary">
                    <div>
                      <p className="text-text-tertiary">Accounts</p>
                      <p className="font-semibold text-text-primary text-sm">{accounts.length}</p>
                    </div>
                    <div>
                      <p className="text-text-tertiary">Average</p>
                      <p className="font-semibold text-text-primary text-sm">{accounts.length > 0 ? formatCurrency(totalBalance / accounts.length) : '—'}</p>
                    </div>
                  </div>
                </div>

                {/* Sparkline */}
                <div className="w-28 h-10 flex-shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={sparkData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#8f6d22" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="#8f6d22" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke="#8f6d22"
                        strokeWidth={1.5}
                        fill="url(#sparkGrad)"
                        dot={false}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </Card>
          </motion.div>

          {/* Expenses + Income row */}
          <motion.div variants={item} className="grid grid-cols-2 gap-4">
            {/* Monthly Spending */}
            <Card>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-text-secondary">Expenses</p>
                  <p className="text-xl font-bold mt-1 text-expense">
                    {formatCurrency(monthlyTotal)}
                  </p>
                </div>
                <div className="w-8 h-8 rounded-lg bg-expense-subtle flex items-center justify-center">
                  <TrendingUp size={16} className="text-expense transform rotate-180" />
                </div>
              </div>
              <div className="flex items-center justify-between text-[11px] mt-2">
                <span className="text-text-tertiary">{getMonthName(targetDate.month)}</span>
                {predictedEndOfMonthSpend > 0 && targetDate.month === new Date().getMonth() + 1 && (
                  <span className="text-expense font-medium">~{formatCurrency(predictedEndOfMonthSpend)} EOM</span>
                )}
              </div>
            </Card>

            {/* Monthly Income */}
            <Card>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-text-secondary">Income</p>
                  <p className="text-xl font-bold mt-1 text-income">
                    {formatCurrency(monthlyIncome)}
                  </p>
                </div>
                <div className="w-8 h-8 rounded-lg bg-income-subtle flex items-center justify-center">
                  <TrendingUp size={16} className="text-income" />
                </div>
              </div>
              <div className="flex items-center gap-1 text-[11px] text-income mt-2">
                <ArrowUpRight size={10} />
                <span>This month</span>
              </div>
            </Card>
          </motion.div>

          {/* Accounts List */}
          <motion.div variants={item}>
            <h2 className="text-sm font-semibold text-text-primary mb-2">Accounts</h2>
            {accounts.length === 0 ? (
              <Card>
                <p className="text-xs text-text-secondary text-center py-2">
                  No accounts yet. Add one to get started.
                </p>
              </Card>
            ) : (
              <div className="space-y-2">
                {accounts.map((acc) => (
                  <Card key={acc.id} className="flex items-center justify-between !py-3">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        acc.type === 'checking' ? 'bg-accent-subtle' : 'bg-income-subtle'
                      }`}>
                        <BankIcon institution={acc.institution} size={14} className={acc.type === 'checking' ? 'text-accent' : 'text-income'} />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-text-primary leading-tight">{acc.name}</p>
                        <span className="text-[11px] text-text-tertiary capitalize">{acc.type}</span>
                      </div>
                    </div>
                    <p className={`text-sm font-semibold ${acc.balance >= 0 ? 'text-text-primary' : 'text-expense'}`}>
                      {formatCurrency(acc.balance)}
                    </p>
                  </Card>
                ))}
              </div>
            )}
          </motion.div>

          {/* Spending by Category */}
          {monthlySpending.length > 0 && (
            <motion.div variants={item}>
              <h2 className="text-sm font-semibold text-text-primary mb-2">Spending by Category</h2>
              <Card className="!p-0">
                {monthlySpending.map((cat, i) => {
                  const percentage = monthlyTotal > 0 ? (cat.total / monthlyTotal) * 100 : 0;
                  return (
                    <div
                      key={cat.category_name}
                      className={`flex items-center justify-between px-4 py-2.5 ${
                        i < monthlySpending.length - 1 ? 'border-b border-border-subtle' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <span className="text-xs font-medium text-text-primary truncate">
                          {cat.category_name}
                        </span>
                        <div className="flex-1 h-1 bg-border-subtle rounded-full overflow-hidden mx-2">
                          <motion.div
                            className="h-full bg-accent rounded-full"
                            initial={{ width: 0 }}
                            animate={{ width: `${percentage}%` }}
                            transition={{ duration: 0.4, delay: i * 0.04 }}
                          />
                        </div>
                      </div>
                      <span className="text-xs font-medium text-text-secondary flex-shrink-0">
                        {formatCurrency(cat.total)}
                      </span>
                    </div>
                  );
                })}
              </Card>
            </motion.div>
          )}
        </div>

        {/* ─── Col 3: Contextual Panel ─── */}
        <div className="space-y-4">
          {/* Recent Transactions */}
          <motion.div variants={item}>
            <h2 className="text-sm font-semibold text-text-primary mb-2">Recent Transactions</h2>
            {recentTransactions.length === 0 ? (
              <Card>
                <p className="text-xs text-text-secondary text-center py-2">
                  No transactions this month.
                </p>
              </Card>
            ) : (
              <Card className="!p-0 divide-y divide-border-subtle">
                {recentTransactions.map((txn) => (
                  <div key={txn.id} className="flex items-center justify-between px-3.5 py-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${
                        txn.amount >= 0 ? 'bg-income-subtle' : 'bg-expense-subtle'
                      }`}>
                        {txn.amount >= 0 ? (
                          <ArrowUpRight size={12} className="text-income" />
                        ) : (
                          <ArrowDownRight size={12} className="text-expense" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-text-primary truncate">
                          {txn.category_name}
                        </p>
                        <p className="text-[11px] text-text-tertiary truncate">
                          {txn.account_name} · {formatDateShort(txn.date)}
                        </p>
                      </div>
                    </div>
                    <p className={`text-xs font-semibold flex-shrink-0 ml-2 ${
                      txn.amount >= 0 ? 'text-income' : 'text-expense'
                    }`}>
                      {txn.amount >= 0 ? '+' : ''}{formatCurrency(txn.amount)}
                    </p>
                  </div>
                ))}
              </Card>
            )}
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}
