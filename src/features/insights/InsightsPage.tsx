import { useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  CalendarDays,
  Flag,
  Repeat,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card } from '../../components/ui/Card';
import { detectRecurring, forecastMonthEnd, summarizeCashFlow } from '../../lib/finance';
import { formatCurrency, formatDate, getMonthName } from '../../lib/utils';
import { useAccountStore } from '../../store/accountStore';
import { useTransactionStore } from '../../store/transactionStore';
import { useUIStore } from '../../store/uiStore';
import { Amount } from '../../components/ui/Amount';

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
  if (spend === 0) return 'rgba(15,23,42,0.03)';
  if (spend > dailyAverage * 2) return 'rgba(209,87,59,0.95)';
  if (spend > dailyAverage) return 'rgba(220,139,51,0.72)';
  return 'rgba(19,137,94,0.58)';
}

function MetricCard({
  label,
  value,
  amount,
  mode = 'currency',
  description,
  tone = 'text-text-primary',
}: {
  label: string;
  value?: string;
  amount?: number;
  mode?: 'currency' | 'percentage';
  description: string;
  tone?: string;
}) {
  return (
    <Card className="p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">{label}</p>
      <div className={`mt-3 text-3xl font-semibold numeric-display ${tone}`}>
        {amount !== undefined ? (
          <Amount value={amount} mode={mode} />
        ) : (
          value
        )}
      </div>
      <p className="mt-2 text-sm text-text-secondary">{description}</p>
    </Card>
  );
}

export function InsightsPage() {
  const { hasLoaded: accountsLoaded, fetchAccounts } = useAccountStore();
  const {
    transactions,
    hasLoaded: transactionsLoaded,
    fetchTransactions,
    setTransactionFlagged,
  } = useTransactionStore();
  const { selectedMonth, isPrivateMode } = useUIStore();

  useEffect(() => {
    if (!accountsLoaded) void fetchAccounts();
    if (!transactionsLoaded) void fetchTransactions();
  }, [accountsLoaded, fetchAccounts, fetchTransactions, transactionsLoaded]);

  const currentKey = monthKey(selectedMonth.year, selectedMonth.month);
  const monthlyTrend = useMemo(
    () =>
      Array.from({ length: 6 }, (_, index) => {
        const date = monthDateFromOffset(selectedMonth.year, selectedMonth.month, index - 5);
        const key = monthKey(date.getFullYear(), date.getMonth() + 1);
        const monthTransactions = transactions.filter((transaction) => transaction.date.startsWith(key));
        const summary = summarizeCashFlow(monthTransactions);

        return {
          key,
          label: getMonthName(date.getMonth() + 1).slice(0, 3),
          income: summary.income,
          expense: summary.expenses,
          net: summary.netFlow,
        };
      }),
    [selectedMonth.month, selectedMonth.year, transactions],
  );

  const recurringPatterns = useMemo(() => detectRecurring(transactions), [transactions]);
  const recurringExpensePatterns = useMemo(
    () => recurringPatterns.filter((pattern) => pattern.amount < 0),
    [recurringPatterns],
  );
  const recurringExpenseTotal = useMemo(
    () => recurringExpensePatterns.reduce((sum, pattern) => sum + monthlyEquivalent(pattern.amount, pattern.frequency), 0),
    [recurringExpensePatterns],
  );

  const forecast = useMemo(
    () =>
      forecastMonthEnd(
        transactions,
        recurringPatterns,
        new Date(selectedMonth.year, selectedMonth.month - 1, Math.min(new Date().getDate(), 28)),
      ),
    [selectedMonth.month, selectedMonth.year, recurringPatterns, transactions],
  );

  const currentMonthTransactions = useMemo(
    () => transactions.filter((transaction) => transaction.date.startsWith(currentKey)),
    [currentKey, transactions],
  );
  const currentMonthSummary = useMemo(
    () => summarizeCashFlow(currentMonthTransactions),
    [currentMonthTransactions],
  );
  const currentMonthExpenses = useMemo(
    () => currentMonthTransactions.filter((transaction) => transaction.amount < 0),
    [currentMonthTransactions],
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
    const daysInMonth = Math.max(new Date(selectedMonth.year, selectedMonth.month, 0).getDate(), 1);
    return total / daysInMonth;
  }, [currentMonthExpenses, selectedMonth.month, selectedMonth.year]);

  const largestRecentExpenses = useMemo(
    () => [...currentMonthExpenses].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 5),
    [currentMonthExpenses],
  );

  const largestExpenseAmount = useMemo(
    () => Math.max(...largestRecentExpenses.map((transaction) => Math.abs(transaction.amount)), 1),
    [largestRecentExpenses],
  );

  const savingsRate =
    currentMonthSummary.income > 0
      ? ((currentMonthSummary.income - currentMonthSummary.expenses) / currentMonthSummary.income) * 100
      : 0;

  const checkpointMetrics = useMemo(() => {
    const highestIncomeMonth = [...monthlyTrend].sort((a, b) => b.income - a.income)[0];
    const highestExpenseMonth = [...monthlyTrend].sort((a, b) => b.expense - a.expense)[0];
    const strongestNetMonth = [...monthlyTrend].sort((a, b) => b.net - a.net)[0];
    const averageMonthlyNet =
      monthlyTrend.reduce((sum, month) => sum + month.net, 0) / Math.max(monthlyTrend.length, 1);

    return {
      highestIncomeMonth,
      highestExpenseMonth,
      strongestNetMonth,
      averageMonthlyNet,
    };
  }, [monthlyTrend]);

  const daysInMonth = new Date(selectedMonth.year, selectedMonth.month, 0).getDate();
  const firstWeekday = new Date(selectedMonth.year, selectedMonth.month - 1, 1).getDay();
  const calendarCells = Array.from({ length: firstWeekday + daysInMonth }, (_, index) => {
    if (index < firstWeekday) return null;
    return index - firstWeekday + 1;
  });

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1"
    >
      <motion.div variants={item}>
        <Card className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
                Analytics
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-text-primary">
                Financial posture
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">
                Trends, pacing, recurring commitments, and cash-flow checkpoints for {getMonthName(selectedMonth.month)}.
              </p>
            </div>

            <div className="rounded-full border border-border bg-surface-muted px-3 py-1.5 text-xs font-semibold text-text-secondary">
              {getMonthName(selectedMonth.month)} {selectedMonth.year}
            </div>
          </div>
        </Card>
      </motion.div>

      <div className="grid grid-cols-12 gap-4">
        <motion.div variants={item} className="col-span-12 xl:col-span-8">
          <Card className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
                  Trend lines
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-text-primary">Income vs spending</h2>
              </div>
              <div className="flex flex-wrap gap-3 text-xs font-semibold text-text-secondary">
                <span className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-income" />
                  Income
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-expense" />
                  Spending
                </span>
              </div>
            </div>

            <div className="mt-6 h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthlyTrend} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="rgba(15,23,42,0.08)" />
                  <XAxis 
                    dataKey="label" 
                    tickLine={false} 
                    axisLine={false} 
                    tick={{ 
                      fill: 'var(--color-text-tertiary)', 
                      fontSize: 11,
                      filter: isPrivateMode ? 'blur(4px)' : 'none'
                    }} 
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ 
                      fill: 'var(--color-text-tertiary)', 
                      fontSize: 11,
                      filter: isPrivateMode ? 'blur(4px)' : 'none'
                    }}
                    tickFormatter={(value) => `$${Math.round(Number(value) / 1000)}k`}
                  />
                  <Tooltip
                    formatter={(value, name) => [
                      isPrivateMode ? '••••' : formatCurrency(Number(value ?? 0)),
                      name === 'income' ? 'Income' : 'Spending',
                    ]}
                    contentStyle={{
                      borderRadius: 16,
                      border: '1px solid rgba(15,23,42,0.12)',
                      backgroundColor: '#ffffff',
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="income"
                    stroke="var(--color-income)"
                    strokeWidth={3}
                    dot={false}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="expense"
                    stroke="var(--color-expense)"
                    strokeWidth={3}
                    dot={false}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </motion.div>

        <motion.div variants={item} className="col-span-12 grid gap-4 md:grid-cols-2 xl:col-span-4 xl:grid-cols-1">
          <MetricCard
            label="Net flow"
            amount={currentMonthSummary.netFlow}
            description="Income minus spending for the selected month."
            tone={currentMonthSummary.netFlow >= 0 ? 'text-income' : 'text-expense'}
          />
          <MetricCard
            label="Savings rate"
            amount={savingsRate}
            mode="percentage"
            description="Share of income left after expenses."
            tone={savingsRate >= 0 ? 'text-text-primary' : 'text-expense'}
          />
        </motion.div>

        <motion.div variants={item} className="col-span-12 md:col-span-4">
          <MetricCard
            label="Income"
            amount={currentMonthSummary.income}
            description="Recorded income this month."
            tone="text-income"
          />
        </motion.div>

        <motion.div variants={item} className="col-span-12 md:col-span-4">
          <MetricCard
            label="Spending"
            amount={currentMonthSummary.expenses}
            description="Recorded outflow this month."
            tone="text-expense"
          />
        </motion.div>

        <motion.div variants={item} className="col-span-12 md:col-span-4">
          <MetricCard
            label="Recurring spend"
            amount={recurringExpenseTotal}
            description="Estimated monthly recurring obligations."
          />
        </motion.div>

        <motion.div variants={item} className="col-span-12 xl:col-span-4">
          <Card className="h-full p-6">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-warning-subtle text-warning">
                <AlertTriangle size={20} />
              </span>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
                  Forecast
                </p>
                <h2 className="mt-1 text-2xl font-semibold text-text-primary">Month-end outlook</h2>
              </div>
            </div>

            {forecast.active ? (
              <div className="mt-6 space-y-4">
                <div className={`text-4xl font-semibold numeric-display ${forecast.projectedNetFlow >= 0 ? 'text-income' : 'text-expense'}`}>
                  <Amount value={forecast.projectedNetFlow} />
                </div>
                <div className="space-y-3">
                  <div className="rounded-2xl border border-border bg-surface-muted px-4 py-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-text-secondary">
                      Confirmed recurring
                    </p>
                    <div className="mt-2 text-lg font-semibold text-text-primary numeric-display">
                      <Amount value={forecast.confirmedRecurring} />
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border bg-surface-muted px-4 py-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-text-secondary">
                      Variable pace
                    </p>
                    <div className="mt-2 text-lg font-semibold text-text-primary numeric-display">
                      <Amount value={forecast.projectedVariable} />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-6 rounded-2xl border border-border bg-surface-muted px-4 py-5 text-sm text-text-secondary">
                Forecast unlocks after 14 days and at least 10 transactions in the selected month.
              </div>
            )}
          </Card>
        </motion.div>

        <motion.div variants={item} className="col-span-12 xl:col-span-4">
          <Card className="h-full p-6">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-info-subtle text-info">
                <Repeat size={20} />
              </span>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
                  Recurring commitments
                </p>
                <h2 className="mt-1 text-2xl font-semibold text-text-primary">Detected patterns</h2>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              {recurringExpensePatterns.length === 0 ? (
                <div className="rounded-2xl border border-border bg-surface-muted px-4 py-5 text-sm text-text-secondary">
                  No recurring commitments detected yet.
                </div>
              ) : (
                recurringExpensePatterns.slice(0, 4).map((pattern) => (
                  <div key={`${pattern.note}-${pattern.last_date}`} className="rounded-2xl border border-border bg-surface-muted px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-text-primary">{pattern.note}</p>
                      <div className="text-sm font-semibold text-expense numeric-display">
                        <Amount value={Math.abs(pattern.amount)} />
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-text-secondary">
                      {pattern.frequency} / next expected {formatDate(pattern.next_expected_date)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </Card>
        </motion.div>

        <motion.div variants={item} className="col-span-12 xl:col-span-4">
          <Card className="h-full p-6">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-subtle text-accent">
                <CalendarDays size={20} />
              </span>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
                  Spending cadence
                </p>
                <h2 className="mt-1 text-2xl font-semibold text-text-primary">Calendar view</h2>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-7 gap-2">
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
                <div key={`${day}-${index}`} className="text-center text-xs font-semibold uppercase tracking-[0.14em] text-text-tertiary">
                  {day}
                </div>
              ))}

              {calendarCells.map((day, index) => {
                if (day == null) {
                  return <div key={`empty-${index}`} className="aspect-square rounded-2xl bg-transparent" />;
                }

                const entry = dailyCadence.get(day) ?? { spend: 0, count: 0 };

                return (
                  <div
                    key={day}
                    title={`${formatDate(`${currentKey}-${String(day).padStart(2, '0')}`)} | ${isPrivateMode ? '••••' : formatCurrency(entry.spend)} | ${entry.count} transaction${entry.count === 1 ? '' : 's'}`}
                    className="flex aspect-square flex-col justify-between rounded-2xl border border-border px-2 py-2 text-xs text-text-primary"
                    style={{ backgroundColor: getCadenceTone(entry.spend, dailyAverage) }}
                  >
                    <span className="font-semibold">{day}</span>
                    <span className="text-[11px] text-text-secondary">{entry.count || ''}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        </motion.div>

        <motion.div variants={item} className="col-span-12 xl:col-span-6">
          <Card className="p-6">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-expense-subtle text-expense">
                <TrendingDown size={20} />
              </span>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
                  High-impact expenses
                </p>
                <h2 className="mt-1 text-2xl font-semibold text-text-primary">Largest recent outflows</h2>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              {largestRecentExpenses.length === 0 ? (
                <div className="rounded-2xl border border-border bg-surface-muted px-4 py-5 text-sm text-text-secondary">
                  No expense activity this month yet.
                </div>
              ) : (
                largestRecentExpenses.map((transaction) => (
                  <div key={transaction.id} className="rounded-2xl border border-border bg-surface-muted px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-text-primary">
                          {transaction.note?.trim() || transaction.category_name}
                        </p>
                        <p className="mt-1 text-xs text-text-secondary">
                          {transaction.account_name} / {transaction.category_name} / {formatDate(transaction.date)}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold text-expense numeric-display">
                          <Amount value={Math.abs(transaction.amount)} />
                        </div>
                        <button
                          type="button"
                          onClick={() => void setTransactionFlagged(transaction.id, !transaction.flagged)}
                          className={`rounded-xl p-2 ${
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
                        style={{ width: `${(Math.abs(transaction.amount) / largestExpenseAmount) * 100}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </motion.div>

        <motion.div variants={item} className="col-span-12 xl:col-span-6">
          <Card className="p-6">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-subtle text-accent">
                <TrendingUp size={20} />
              </span>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
                  Cash-flow checkpoints
                </p>
                <h2 className="mt-1 text-2xl font-semibold text-text-primary">What stands out</h2>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              <div className="rounded-2xl border border-border bg-surface-muted px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-text-secondary">
                  Highest income month
                </p>
                <p className="mt-2 text-lg font-semibold text-text-primary">
                  {checkpointMetrics.highestIncomeMonth?.label || 'N/A'}
                </p>
                <div className="mt-1 text-sm text-income numeric-display">
                  <Amount value={checkpointMetrics.highestIncomeMonth?.income ?? 0} />
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-surface-muted px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-text-secondary">
                  Highest spending month
                </p>
                <p className="mt-2 text-lg font-semibold text-text-primary">
                  {checkpointMetrics.highestExpenseMonth?.label || 'N/A'}
                </p>
                <div className="mt-1 text-sm text-expense numeric-display">
                  <Amount value={checkpointMetrics.highestExpenseMonth?.expense ?? 0} />
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-surface-muted px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-text-secondary">
                  Strongest net month
                </p>
                <p className="mt-2 text-lg font-semibold text-text-primary">
                  {checkpointMetrics.strongestNetMonth?.label || 'N/A'}
                </p>
                <div className={`mt-1 text-sm numeric-display ${(checkpointMetrics.strongestNetMonth?.net ?? 0) >= 0 ? 'text-income' : 'text-expense'}`}>
                  <Amount value={checkpointMetrics.strongestNetMonth?.net ?? 0} />
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-surface-muted px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-text-secondary">
                  Average monthly net
                </p>
                <div className={`mt-2 text-lg font-semibold numeric-display ${checkpointMetrics.averageMonthlyNet >= 0 ? 'text-income' : 'text-expense'}`}>
                  <Amount value={checkpointMetrics.averageMonthlyNet} />
                </div>
              </div>
            </div>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}
