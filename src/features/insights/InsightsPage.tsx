import { useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, ArrowUpRight, Landmark, PiggyBank, Scale, Wallet } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card } from '../../components/ui/Card';
import {
  calculateCashRunway,
  calculateMonthlySavingsRate,
  calculateTrailingAverageMonthlySpend,
  summarizeCashFlow,
} from '../../lib/finance';
import { useAccountStore } from '../../store/accountStore';
import { useTransactionStore } from '../../store/transactionStore';
import { formatCurrency, formatDate, getCurrentMonth, getMonthName } from '../../lib/utils';

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.04 } },
};

const item = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0 },
};

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function monthDateFromOffset(year: number, month: number, offset: number): Date {
  return new Date(year, month - 1 + offset, 1);
}

export function InsightsPage() {
  const { accounts, totalBalance, hasLoaded: accountsLoaded, fetchAccounts } = useAccountStore();
  const { transactions, hasLoaded: transactionsLoaded, fetchTransactions } = useTransactionStore();

  useEffect(() => {
    if (!accountsLoaded) fetchAccounts();
    if (!transactionsLoaded) fetchTransactions();
  }, [accountsLoaded, transactionsLoaded, fetchAccounts, fetchTransactions]);

  const currentMonth = getCurrentMonth();

  const monthlyTrend = useMemo(() => {
    return Array.from({ length: 6 }, (_, index) => {
      const date = monthDateFromOffset(currentMonth.year, currentMonth.month, index - 5);
      const key = monthKey(date.getFullYear(), date.getMonth() + 1);
      const summary = summarizeCashFlow(transactions.filter((transaction) => transaction.date.startsWith(key)));

      return {
        key,
        label: getMonthName(date.getMonth() + 1).slice(0, 3),
        income: Number(summary.income.toFixed(2)),
        expense: Number(summary.expenses.toFixed(2)),
        net: Number(summary.netFlow.toFixed(2)),
      };
    });
  }, [currentMonth.month, currentMonth.year, transactions]);

  const trailingAverageExpense = useMemo(() => {
    return calculateTrailingAverageMonthlySpend(
      transactions,
      3,
      new Date(currentMonth.year, currentMonth.month - 1, 1),
    ).average;
  }, [currentMonth.month, currentMonth.year, transactions]);

  const liquidityMonths = calculateCashRunway(totalBalance, trailingAverageExpense);
  const currentMonthSummary = monthlyTrend[monthlyTrend.length - 1] ?? { income: 0, expense: 0, net: 0 };
  const savingsRate = calculateMonthlySavingsRate(currentMonthSummary.income, currentMonthSummary.expense);

  const accountAllocation = useMemo(() => {
    const positiveAccounts = accounts
      .filter((account) => account.balance > 0)
      .sort((a, b) => b.balance - a.balance);

    const positiveTotal = positiveAccounts.reduce((sum, account) => sum + account.balance, 0);

    return positiveAccounts.map((account, index) => ({
      ...account,
      share: positiveTotal > 0 ? (account.balance / positiveTotal) * 100 : 0,
      color: index === 0 ? '#A88B4A' : index === 1 ? '#2E6F95' : '#7F8EA3',
    }));
  }, [accounts]);

  const largestAccountShare = accountAllocation[0]?.share ?? 0;

  const recentExpenses = useMemo(() => {
    return transactions
      .filter((transaction) => transaction.amount < 0)
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      .slice(0, 5);
  }, [transactions]);

  const focusAreas = useMemo(() => {
    const items: { title: string; body: string; tone: 'good' | 'warn' }[] = [];

    if (liquidityMonths !== null) {
      if (liquidityMonths < 2) {
        items.push({
          title: 'Liquidity is thin',
          body: `Current balances cover about ${liquidityMonths.toFixed(1)} months of recent spending. Building more cash buffer would reduce pressure.`,
          tone: 'warn',
        });
      } else if (liquidityMonths >= 4) {
        items.push({
          title: 'Liquidity looks healthy',
          body: `You currently hold about ${liquidityMonths.toFixed(1)} months of recent spending across your accounts.`,
          tone: 'good',
        });
      }
    }

    if (largestAccountShare >= 65) {
      items.push({
        title: 'Balances are concentrated',
        body: `${largestAccountShare.toFixed(0)}% of positive balances sit in one account. That may be fine, but it is worth checking whether your cash is organized intentionally.`,
        tone: 'warn',
      });
    }

    if (currentMonthSummary.income > 0 && savingsRate < 15) {
      items.push({
        title: 'Savings rate is under pressure',
        body: `This month is currently tracking at a ${savingsRate.toFixed(1)}% savings rate, so spending is absorbing most incoming cash flow.`,
        tone: 'warn',
      });
    } else if (currentMonthSummary.income > 0 && savingsRate >= 20) {
      items.push({
        title: 'Savings pace is strong',
        body: `This month is currently keeping ${savingsRate.toFixed(1)}% of income after expenses, which is a strong savings posture.`,
        tone: 'good',
      });
    }

    if (items.length === 0) {
      items.push({
        title: 'Pattern still forming',
        body: 'Once you have a bit more transaction history, Monet can call out stronger financial trends here without overfitting early data.',
        tone: 'good',
      });
    }

    return items.slice(0, 3);
  }, [currentMonthSummary.income, liquidityMonths, largestAccountShare, savingsRate]);

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1 pb-4">
      <motion.div variants={item} className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">Insights</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-text-primary">Financial posture</h1>
          <p className="mt-1 max-w-3xl text-sm text-text-secondary">A deeper view of liquidity, balance concentration, spending cadence, and the transactions shaping your current position.</p>
        </div>
        <p className="text-xs text-text-secondary">Built to complement the dashboard, not crowd it.</p>
      </motion.div>

      <div className="grid grid-cols-12 gap-4">
        <motion.div variants={item} className="col-span-12 md:col-span-6 xl:col-span-3">
          <Card className="h-full rounded-[24px] p-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-accent-subtle text-accent">
                <Wallet size={18} />
              </span>
              <div>
                <p className="text-[11px] uppercase tracking-[0.12em] text-text-secondary">Liquidity</p>
                <p className="mt-1 text-2xl font-semibold numeric-display text-text-primary">
                  {liquidityMonths === null ? 'N/A' : `${liquidityMonths.toFixed(1)} mo`}
                </p>
              </div>
            </div>
            <p className="mt-3 text-xs leading-5 text-text-secondary">Based on your trailing 3-month average spend.</p>
          </Card>
        </motion.div>

        <motion.div variants={item} className="col-span-12 md:col-span-6 xl:col-span-3">
          <Card className="h-full rounded-[24px] p-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-income-subtle text-income">
                <PiggyBank size={18} />
              </span>
              <div>
                <p className="text-[11px] uppercase tracking-[0.12em] text-text-secondary">Savings Rate</p>
                <p className={`mt-1 text-2xl font-semibold numeric-display ${savingsRate >= 0 ? 'text-income' : 'text-expense'}`}>
                  {savingsRate.toFixed(1)}%
                </p>
              </div>
            </div>
            <p className="mt-3 text-xs leading-5 text-text-secondary">Current month net cash flow divided by current month income.</p>
          </Card>
        </motion.div>

        <motion.div variants={item} className="col-span-12 md:col-span-6 xl:col-span-3">
          <Card className="h-full rounded-[24px] p-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-warning-subtle text-warning">
                <Scale size={18} />
              </span>
              <div>
                <p className="text-[11px] uppercase tracking-[0.12em] text-text-secondary">Largest Account</p>
                <p className="mt-1 text-2xl font-semibold numeric-display text-text-primary">{largestAccountShare.toFixed(0)}%</p>
              </div>
            </div>
            <p className="mt-3 text-xs leading-5 text-text-secondary">Share of positive balances held in your biggest account.</p>
          </Card>
        </motion.div>

        <motion.div variants={item} className="col-span-12 md:col-span-6 xl:col-span-3">
          <Card className="h-full rounded-[24px] p-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-accent-subtle text-accent">
                <Landmark size={18} />
              </span>
              <div>
                <p className="text-[11px] uppercase tracking-[0.12em] text-text-secondary">Average Spend</p>
                <p className="mt-1 text-2xl font-semibold numeric-display text-text-primary">{formatCurrency(trailingAverageExpense)}</p>
              </div>
            </div>
            <p className="mt-3 text-xs leading-5 text-text-secondary">Trailing 3-month average expense run rate.</p>
          </Card>
        </motion.div>
      </div>

      <div className="grid grid-cols-12 items-start gap-4">
        <motion.div variants={item} className="col-span-12 xl:col-span-8">
          <Card className="rounded-[24px] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Income vs spending trend</h2>
                <p className="text-sm text-text-secondary">The last six months, split into money in and money out.</p>
              </div>
              <span className="text-xs text-text-secondary">6 months</span>
            </div>

            <div className="mt-5 h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyTrend} barGap={8}>
                  <CartesianGrid vertical={false} stroke="rgba(15,23,42,0.08)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} tickFormatter={(value) => `$${Math.round(Number(value) / 1000)}k`} />
                  <Tooltip
                    formatter={(value, name) => [formatCurrency(Number(value ?? 0)), name === 'income' ? 'Income' : 'Spending']}
                    contentStyle={{ borderRadius: 12, border: '1px solid rgba(255,255,255,0.8)', backgroundColor: 'rgba(255,255,255,0.94)' }}
                  />
                  <Bar dataKey="income" fill="#10B981" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="expense" fill="#A88B4A" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </motion.div>

        <motion.div variants={item} className="col-span-12 xl:col-span-4">
          <Card className="rounded-[24px] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Focus areas</h2>
                <p className="text-sm text-text-secondary">Signals worth attention right now.</p>
              </div>
              <AlertTriangle size={16} className="text-warning" />
            </div>

            <div className="mt-4 space-y-3">
              {focusAreas.map((focus) => (
                <div
                  key={focus.title}
                  className={`rounded-2xl border px-4 py-3 ${
                    focus.tone === 'warn'
                      ? 'border-warning/20 bg-warning-subtle'
                      : 'border-income/20 bg-income-subtle'
                  }`}
                >
                  <p className="text-sm font-semibold text-text-primary">{focus.title}</p>
                  <p className="mt-1 text-xs leading-5 text-text-secondary">{focus.body}</p>
                </div>
              ))}
            </div>
          </Card>
        </motion.div>

        <motion.div variants={item} className="col-span-12 xl:col-span-5">
          <Card className="rounded-[24px] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Account allocation</h2>
                <p className="text-sm text-text-secondary">Where your positive balances currently sit.</p>
              </div>
              <ArrowUpRight size={16} className="text-accent" />
            </div>

            {accountAllocation.length === 0 ? (
              <div className="mt-5 rounded-2xl border border-white/55 bg-white/55 px-4 py-6 text-sm text-text-secondary">
                Add account balances to unlock allocation analysis.
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {accountAllocation.map((account) => (
                  <div key={account.id}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-text-primary">{account.name}</p>
                        <p className="text-xs text-text-secondary">{account.type}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold numeric-display text-text-primary">{formatCurrency(account.balance)}</p>
                        <p className="text-xs text-text-secondary">{account.share.toFixed(0)}%</p>
                      </div>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/6">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(account.share, 4)}%`, backgroundColor: account.color }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </motion.div>

        <motion.div variants={item} className="col-span-12 xl:col-span-7">
          <Card className="rounded-[24px] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Largest recent expenses</h2>
                <p className="text-sm text-text-secondary">High-impact outflows across your current transaction history.</p>
              </div>
              <span className="text-xs text-text-secondary">Top 5</span>
            </div>

            {recentExpenses.length === 0 ? (
              <div className="mt-5 rounded-2xl border border-white/55 bg-white/55 px-4 py-6 text-sm text-text-secondary">
                Expense activity will appear here once transactions are added.
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {recentExpenses.map((transaction) => (
                  <div key={transaction.id} className="rounded-2xl border border-white/55 bg-white/55 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-text-primary">
                          {transaction.note?.trim() || transaction.category_name}
                        </p>
                        <p className="mt-1 text-xs text-text-secondary">
                          {transaction.account_name} • {transaction.category_name} • {formatDate(transaction.date)}
                        </p>
                      </div>
                      <p className="text-sm font-semibold numeric-display text-expense">
                        {formatCurrency(transaction.amount)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </motion.div>

        <motion.div variants={item} className="col-span-12">
          <Card className="rounded-[24px] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Monthly net flow snapshot</h2>
                <p className="text-sm text-text-secondary">A quick comparison of what each recent month kept after spending.</p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
              {monthlyTrend.map((month) => (
                <div key={month.key} className="rounded-2xl border border-white/55 bg-white/55 px-4 py-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">{month.label}</p>
                  <p className={`mt-3 text-xl font-semibold numeric-display ${month.net >= 0 ? 'text-income' : 'text-expense'}`}>
                    {formatCurrency(month.net)}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-text-secondary">
                    Income {formatCurrency(month.income)} • Spend {formatCurrency(month.expense)}
                  </p>
                </div>
              ))}
            </div>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}
