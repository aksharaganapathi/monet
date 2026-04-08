import { useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, CalendarDays, Flag, Repeat, TrendingUp } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card } from '../../components/ui/Card';
import { detectRecurring, forecastMonthEnd } from '../../lib/finance';
import { formatCurrency, formatDate, getMonthName } from '../../lib/utils';
import { useAccountStore } from '../../store/accountStore';
import { useTransactionStore } from '../../store/transactionStore';
import { useUIStore } from '../../store/uiStore';

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

function monthlyEquivalent(amount: number, frequency: 'daily' | 'weekly' | 'monthly' | 'yearly') {
  if (frequency === 'daily') return Math.abs(amount) * 30;
  if (frequency === 'weekly') return Math.abs(amount) * 4.33;
  if (frequency === 'yearly') return Math.abs(amount) / 12;
  return Math.abs(amount);
}

function getCadenceTone(spend: number, dailyAverage: number): string {
  if (spend === 0) return '#ffffff';
  if (spend > dailyAverage * 2) return 'var(--color-expense)';
  if (spend > dailyAverage) return 'var(--color-accent)';
  return 'var(--color-gold-light)';
}

export function InsightsPage() {
  const { hasLoaded: accountsLoaded, fetchAccounts } = useAccountStore();
  const {
    transactions,
    hasLoaded: transactionsLoaded,
    fetchTransactions,
    setTransactionFlagged,
  } = useTransactionStore();
  const { selectedMonth, applyTransactionCategoryMonthFilter } = useUIStore();

  useEffect(() => {
    if (!accountsLoaded) void fetchAccounts();
    if (!transactionsLoaded) void fetchTransactions();
  }, [accountsLoaded, fetchAccounts, fetchTransactions, transactionsLoaded]);

  const currentMonth = selectedMonth;
  const currentKey = monthKey(currentMonth.year, currentMonth.month);
  const previousDate = monthDateFromOffset(currentMonth.year, currentMonth.month, -1);
  const previousKey = monthKey(previousDate.getFullYear(), previousDate.getMonth() + 1);

  const monthlyTrend = useMemo(
    () =>
      Array.from({ length: 6 }, (_, index) => {
        const date = monthDateFromOffset(currentMonth.year, currentMonth.month, index - 5);
        const key = monthKey(date.getFullYear(), date.getMonth() + 1);
        const monthTransactions = transactions.filter((transaction) => transaction.date.startsWith(key));
        const income = monthTransactions
          .filter((transaction) => transaction.amount > 0)
          .reduce((sum, transaction) => sum + transaction.amount, 0);
        const expense = monthTransactions
          .filter((transaction) => transaction.amount < 0)
          .reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);

        return {
          key,
          label: getMonthName(date.getMonth() + 1).slice(0, 3),
          income,
          expense,
          net: income - expense,
        };
      }),
    [currentMonth.month, currentMonth.year, transactions],
  );

  const recurringPatterns = useMemo(() => detectRecurring(transactions), [transactions]);

  const recurringExpensePatterns = useMemo(
    () => recurringPatterns.filter((pattern) => pattern.amount < 0),
    [recurringPatterns],
  );

  const recurringExpenseTotal = useMemo(
    () =>
      recurringExpensePatterns.reduce(
        (sum, pattern) => sum + monthlyEquivalent(pattern.amount, pattern.frequency),
        0,
      ),
    [recurringExpensePatterns],
  );

  const forecast = useMemo(
    () =>
      forecastMonthEnd(
        transactions,
        recurringPatterns,
        new Date(currentMonth.year, currentMonth.month - 1, Math.min(new Date().getDate(), 28)),
      ),
    [currentMonth.month, currentMonth.year, recurringPatterns, transactions],
  );

  const currentMonthTransactions = useMemo(
    () => transactions.filter((transaction) => transaction.date.startsWith(currentKey)),
    [currentKey, transactions],
  );

  const currentMonthExpenses = useMemo(
    () => currentMonthTransactions.filter((transaction) => transaction.amount < 0),
    [currentMonthTransactions],
  );

  const previousMonthExpenses = useMemo(
    () =>
      transactions.filter(
        (transaction) => transaction.date.startsWith(previousKey) && transaction.amount < 0,
      ),
    [previousKey, transactions],
  );

  const dailyCadence = useMemo(() => {
    const map = new Map<number, { spend: number; count: number }>();

    currentMonthExpenses.forEach((transaction) => {
      const day = Number.parseInt(transaction.date.slice(8, 10), 10);
      const entry = map.get(day) ?? { spend: 0, count: 0 };
      entry.spend += Math.abs(transaction.amount);
      entry.count += 1;
      map.set(day, entry);
    });

    return map;
  }, [currentMonthExpenses]);

  const dailyAverage = useMemo(() => {
    const total = currentMonthExpenses.reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
    const daysInMonth = Math.max(new Date(currentMonth.year, currentMonth.month, 0).getDate(), 1);
    return total / daysInMonth;
  }, [currentMonth.month, currentMonth.year, currentMonthExpenses]);

  const largestRecentExpenses = useMemo(
    () => [...currentMonthExpenses].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 5),
    [currentMonthExpenses],
  );

  const largestExpenseAmount = useMemo(
    () => Math.max(...largestRecentExpenses.map((transaction) => Math.abs(transaction.amount)), 1),
    [largestRecentExpenses],
  );

  const categoryBreakdown = useMemo(() => {
    const current = new Map<string, number>();
    const previous = new Map<string, number>();

    currentMonthExpenses.forEach((transaction) => {
      current.set(
        transaction.category_name,
        (current.get(transaction.category_name) ?? 0) + Math.abs(transaction.amount),
      );
    });

    previousMonthExpenses.forEach((transaction) => {
      previous.set(
        transaction.category_name,
        (previous.get(transaction.category_name) ?? 0) + Math.abs(transaction.amount),
      );
    });

    const totalExpenses = [...current.values()].reduce((sum, value) => sum + value, 0);

    return [...current.entries()]
      .map(([category, spent]) => {
        const previousSpent = previous.get(category) ?? null;
        return {
          category,
          spent,
          share: totalExpenses > 0 ? (spent / totalExpenses) * 100 : 0,
          delta: previousSpent == null ? null : spent - previousSpent,
        };
      })
      .sort((left, right) => right.spent - left.spent);
  }, [currentMonthExpenses, previousMonthExpenses]);

  const daysInMonth = new Date(currentMonth.year, currentMonth.month, 0).getDate();

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pb-4 pr-1"
    >
      <motion.div variants={item}>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
            Insights
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-text-primary">
            Financial posture
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            A deeper view of cadence, recurring commitments, and category changes shaping
            this month.
          </p>
        </div>
      </motion.div>

      <div className="grid grid-cols-12 gap-4">
        <motion.div variants={item} className="col-span-12 xl:col-span-8">
          <Card className="rounded-xl p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-text-primary">
                  Income vs spending trend
                </h2>
                <p className="text-sm text-text-secondary">
                  The last six months, split into money in and money out.
                </p>
              </div>
              <span className="text-xs text-text-secondary">6 months</span>
            </div>

            <div className="mt-5 h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyTrend} barGap={8}>
                  <CartesianGrid vertical={false} stroke="rgba(15,23,42,0.08)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `$${Math.round(Number(value) / 1000)}k`}
                  />
                  <Tooltip
                    formatter={(value, name) => [
                      formatCurrency(Number(value ?? 0)),
                      name === 'income' ? 'Income' : 'Spending',
                    ]}
                    contentStyle={{
                      borderRadius: 12,
                      border: '1px solid rgba(22,27,36,0.16)',
                      backgroundColor: 'var(--color-surface-elevated)',
                    }}
                  />
                  <Bar dataKey="income" fill="var(--color-income)" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="expense" fill="var(--color-accent)" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </motion.div>

        <motion.div variants={item} className="col-span-12 xl:col-span-4">
          <Card className="rounded-xl p-5">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-warning-subtle text-warning">
                <AlertTriangle size={18} />
              </span>
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Month-end forecast</h2>
                <p className="text-sm text-text-secondary">
                  Recurring spend plus variable pace, gated behind enough data.
                </p>
              </div>
            </div>

            {forecast.active ? (
              <div className="mt-4 space-y-3">
                <p
                  className={`numeric-display text-3xl font-semibold ${
                    forecast.projectedNetFlow >= 0 ? 'text-income' : 'text-expense'
                  }`}
                >
                  {formatCurrency(forecast.projectedNetFlow)}
                </p>
                <p className="text-sm text-text-secondary">
                  {forecast.confidenceLabel} net flow for the month.
                </p>
                <div className="rounded-xl bg-surface-muted p-4 text-sm text-text-secondary">
                  <p>
                    Confirmed recurring:{' '}
                    <span className="numeric-display font-semibold text-text-primary">
                      {formatCurrency(forecast.confirmedRecurring)}
                    </span>
                  </p>
                  <p className="mt-2">
                    Variable spend:{' '}
                    <span className="numeric-display font-semibold text-text-primary">
                      {formatCurrency(forecast.projectedVariable)}
                    </span>
                  </p>
                  <p className="mt-2">
                    Based on {forecast.transactionCount} transactions and {forecast.daysElapsed}{' '}
                    days of data.
                  </p>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-text-secondary">
                Forecast available after 14 days and 10+ transactions this month.
              </p>
            )}
          </Card>
        </motion.div>

        <motion.div variants={item} className="col-span-12">
          <Card className="rounded-xl p-5">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent-subtle text-accent">
                <CalendarDays size={18} />
              </span>
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Spending cadence</h2>
                <p className="text-sm text-text-secondary">
                  Your heaviest spending days this month.
                </p>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-7 gap-2 md:grid-cols-14 xl:grid-cols-31">
              {Array.from({ length: daysInMonth }, (_, index) => index + 1).map((day) => {
                const entry = dailyCadence.get(day) ?? { spend: 0, count: 0 };
                const dateLabel = `${currentKey}-${String(day).padStart(2, '0')}`;
                return (
                  <div
                    key={day}
                    title={`${formatDate(dateLabel)} • ${formatCurrency(entry.spend)} • ${entry.count} transaction${entry.count === 1 ? '' : 's'}`}
                    className="flex aspect-square items-center justify-center rounded-md border border-border text-[11px] text-text-secondary"
                    style={{ backgroundColor: getCadenceTone(entry.spend, dailyAverage) }}
                  >
                    {day}
                  </div>
                );
              })}
            </div>
          </Card>
        </motion.div>

        <motion.div variants={item} className="col-span-12 xl:col-span-6">
          <Card className="rounded-xl p-5">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-info-subtle text-info">
                <Repeat size={18} />
              </span>
              <div>
                <h2 className="text-lg font-semibold text-text-primary">
                  Recurring commitments
                </h2>
                <p className="text-sm text-text-secondary">
                  Patterns Monet detected from repeated notes, amounts, and intervals.
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {recurringExpensePatterns.length === 0 ? (
                <p className="text-sm text-text-secondary">
                  No recurring commitments detected yet.
                </p>
              ) : (
                recurringExpensePatterns.map((pattern) => (
                  <div
                    key={`${pattern.note}-${pattern.last_date}`}
                    className="rounded-xl bg-surface-muted px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-text-primary">{pattern.note}</p>
                      <p className="numeric-display text-sm font-semibold text-expense">
                        {formatCurrency(Math.abs(pattern.amount))}
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-text-secondary">
                      {pattern.frequency} • next expected {formatDate(pattern.next_expected_date)}
                    </p>
                  </div>
                ))
              )}
            </div>

            <p className="mt-4 text-sm text-text-secondary">
              ~{formatCurrency(recurringExpenseTotal)}/month in detected recurring expenses
            </p>
          </Card>
        </motion.div>

        <motion.div variants={item} className="col-span-12 xl:col-span-6">
          <Card className="rounded-xl p-5">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent-subtle text-accent">
                <TrendingUp size={18} />
              </span>
              <div>
                <h2 className="text-lg font-semibold text-text-primary">
                  Largest recent expenses
                </h2>
                <p className="text-sm text-text-secondary">
                  High-impact outflows with context and review controls.
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {largestRecentExpenses.length === 0 ? (
                <p className="text-sm text-text-secondary">No expense activity this month yet.</p>
              ) : (
                largestRecentExpenses.map((transaction) => (
                  <div key={transaction.id} className="rounded-xl bg-surface-muted px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-text-primary">
                          {transaction.note?.trim() || transaction.category_name}
                        </p>
                        <p className="mt-1 text-xs text-text-secondary">
                          {transaction.account_name} • {transaction.category_name} •{' '}
                          {formatDate(transaction.date)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <p className="numeric-display text-sm font-semibold text-expense">
                          {formatCurrency(Math.abs(transaction.amount))}
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            void setTransactionFlagged(transaction.id, !transaction.flagged)
                          }
                          className={`rounded-lg p-2 ${
                            transaction.flagged
                              ? 'bg-warning-subtle text-warning'
                              : 'text-text-tertiary hover:bg-warning-subtle hover:text-warning'
                          }`}
                        >
                          <Flag size={15} />
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 h-2 rounded-full bg-white">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{
                          width: `${(Math.abs(transaction.amount) / largestExpenseAmount) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </motion.div>

        <motion.div variants={item} className="col-span-12">
          <Card className="rounded-xl p-5">
            <h2 className="text-lg font-semibold text-text-primary">Category breakdown</h2>
            <p className="mt-1 text-sm text-text-secondary">
              Click a row to open Transactions filtered to that category for the current
              month.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border-subtle text-left text-text-secondary">
                    <th className="pb-3 font-medium">Category</th>
                    <th className="pb-3 font-medium">Spent</th>
                    <th className="pb-3 font-medium">% of expenses</th>
                    <th className="pb-3 font-medium">vs. last month</th>
                  </tr>
                </thead>
                <tbody>
                  {categoryBreakdown.map((row) => (
                    <tr
                      key={row.category}
                      className="cursor-pointer border-b border-border-subtle transition-colors hover:bg-surface-muted"
                      onClick={() =>
                        applyTransactionCategoryMonthFilter(row.category, selectedMonth)
                      }
                    >
                      <td className="py-3 font-medium text-text-primary">{row.category}</td>
                      <td className="numeric-display py-3">{formatCurrency(row.spent)}</td>
                      <td className="py-3">{row.share.toFixed(1)}%</td>
                      <td
                        className={`py-3 ${
                          row.delta == null
                            ? 'text-text-tertiary'
                            : row.delta >= 0
                              ? 'text-expense'
                              : 'text-income'
                        }`}
                      >
                        {row.delta == null
                          ? 'No prior month data'
                          : `${row.delta >= 0 ? '↑' : '↓'} ${formatCurrency(Math.abs(row.delta))}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}
