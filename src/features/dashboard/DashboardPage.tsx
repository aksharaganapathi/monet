import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowDownRight,
  ArrowUpRight,
  CreditCard,
  TrendingDown,
  TrendingUp,
  WandSparkles,
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { calculateNetWorth, detectRecurring, groupTransactionsByCategory, summarizeCashFlow } from '../../lib/finance';
import { insightsRepository } from '../../lib/repositories/insightsRepository';
import { formatCurrency, formatDateShort, getMonthName } from '../../lib/utils';
import { useAccountStore } from '../../store/accountStore';
import { useCategoryStore } from '../../store/categoryStore';
import { useTransactionStore } from '../../store/transactionStore';
import { useUIStore } from '../../store/uiStore';
import { Amount } from '../../components/ui/Amount';

function toMonthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function getMonthEndIso(year: number, month: number) {
  const end = new Date(year, month, 0);
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
}

function percentDelta(current: number, previous: number) {
  if (previous === 0) {
    return current === 0 ? 0 : 100;
  }
  return ((current - previous) / previous) * 100;
}

function monthlyEquivalent(amount: number, frequency: 'daily' | 'weekly' | 'monthly' | 'yearly') {
  if (frequency === 'daily') return Math.abs(amount) * 30;
  if (frequency === 'weekly') return Math.abs(amount) * 4.33;
  if (frequency === 'yearly') return Math.abs(amount) / 12;
  return Math.abs(amount);
}

function TrendPill({ value, inverse = false }: { value: number; inverse?: boolean }) {
  const isPrivateMode = useUIStore((state) => state.isPrivateMode);
  const positive = inverse ? value <= 0 : value >= 0;
  const tone = positive ? 'bg-income-subtle text-income' : 'bg-expense-subtle text-expense';
  const display = isPrivateMode ? '•••' : `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;

  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>{display}</span>;
}

function MetricCard({
  icon,
  label,
  amount,
  delta,
  inverse = false,
}: {
  icon: React.ReactNode;
  label: string;
  amount: number;
  delta: number;
  inverse?: boolean;
}) {
  return (
    <Card className="h-full p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent-subtle text-accent">
          {icon}
        </div>
        <TrendPill value={delta} inverse={inverse} />
      </div>

      <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
        {label}
      </p>
      <div className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-text-primary numeric-display">
        <Amount value={amount} />
      </div>
    </Card>
  );
}

function BalanceTooltip({ active, payload, label }: any) {
  const isPrivateMode = useUIStore((state) => state.isPrivateMode);
  if (!active || !payload?.length) return null;

  return (
    <div className="chart-tooltip rounded-2xl px-3 py-2 text-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">{label}</p>
      <div className="mt-1 font-semibold text-text-primary numeric-display">
        {isPrivateMode ? '••••' : formatCurrency(Number(payload[0]?.value ?? 0))}
      </div>
    </div>
  );
}

export function DashboardPage({
  userName,
}: {
  userName?: string;
}) {
  const {
    accounts,
    netWorthTrend,
    hasLoaded: accountsLoaded,
    fetchAccounts,
    fetchNetWorthTrend,
  } = useAccountStore();
  const { transactions, hasLoaded: transactionsLoaded, fetchTransactions } = useTransactionStore();
  const { categories, fetchCategories } = useCategoryStore();
  const { selectedMonth, setActivePage, isPrivateMode } = useUIStore();
  const currentMonthKey = toMonthKey(selectedMonth.year, selectedMonth.month);
  const [aiSummary, setAiSummary] = useState('');
  const [aiStatus, setAiStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  useEffect(() => {
    if (!accountsLoaded) void fetchAccounts();
    if (!transactionsLoaded) void fetchTransactions();
    void fetchCategories();
    void fetchNetWorthTrend();
  }, [accountsLoaded, fetchAccounts, fetchCategories, fetchNetWorthTrend, fetchTransactions, transactionsLoaded]);

  const selectedMonthStoryRevision = useMemo(
    () =>
      transactions
        .filter((transaction) => transaction.date.startsWith(currentMonthKey))
        .map(
          (transaction) =>
            `${transaction.id}:${transaction.amount}:${transaction.category_id}:${transaction.account_id}:${transaction.date}:${transaction.note ?? ''}`,
        )
        .sort()
        .join('|'),
    [currentMonthKey, transactions],
  );

  useEffect(() => {
    let cancelled = false;


    const loadSummary = async () => {
      setAiStatus('loading');
      try {
        const summary = await insightsRepository.getMonthStory(selectedMonth.year, selectedMonth.month);
        if (!cancelled) {
          setAiSummary(summary);
          setAiStatus('ready');
        }
      } catch {
        if (!cancelled) {
          setAiSummary('');
          setAiStatus('error');
        }
      }
    };

    void loadSummary();

    return () => {
      cancelled = true;
    };
  }, [selectedMonth.month, selectedMonth.year, selectedMonthStoryRevision]);

  const netWorth = calculateNetWorth(accounts);
  const previousMonthDate = new Date(selectedMonth.year, selectedMonth.month - 2, 1);
  const previousMonthKey = toMonthKey(previousMonthDate.getFullYear(), previousMonthDate.getMonth() + 1);
  const selectedMonthEnd = getMonthEndIso(selectedMonth.year, selectedMonth.month);

  const dashboardData = useMemo(() => {
    const thisMonthTransactions = transactions.filter((transaction) => transaction.date.startsWith(currentMonthKey));
    const lastMonthTransactions = transactions.filter((transaction) => transaction.date.startsWith(previousMonthKey));

    const thisMonthSummary = summarizeCashFlow(thisMonthTransactions);
    const lastMonthSummary = summarizeCashFlow(lastMonthTransactions);

    const recurringExpenseTotal = detectRecurring(thisMonthTransactions)
      .filter((pattern) => pattern.amount < 0)
      .reduce((sum, pattern) => sum + monthlyEquivalent(pattern.amount, pattern.frequency), 0);

    const monthlyBalanceFallback = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(selectedMonth.year, selectedMonth.month - 1 - (5 - index), 1);
      const monthKey = toMonthKey(date.getFullYear(), date.getMonth() + 1);
      const monthTransactions = transactions.filter((transaction) => transaction.date.startsWith(monthKey));
      const monthSummary = summarizeCashFlow(monthTransactions);
      const monthEnd = getMonthEndIso(date.getFullYear(), date.getMonth() + 1);
      const futureDelta = transactions
        .filter((transaction) => transaction.date > monthEnd)
        .reduce((sum, transaction) => sum + transaction.amount, 0);

      return {
        label: getMonthName(date.getMonth() + 1).slice(0, 3),
        balance: netWorth - futureDelta,
        income: monthSummary.income,
        expenses: monthSummary.expenses,
      };
    });

    const snapshotTrend = netWorthTrend
      .filter((point) => point.date <= selectedMonthEnd)
      .slice(-8)
      .map((point) => ({
        label: formatDateShort(point.date),
        balance: point.value,
      }));

    const usesSnapshots = snapshotTrend.length >= 4;
    const balanceTrend = usesSnapshots
      ? snapshotTrend
      : monthlyBalanceFallback.map((entry) => ({
          label: entry.label,
          balance: entry.balance,
        }));

    const thisMonthExpenses = thisMonthTransactions.filter((transaction) => transaction.amount < 0);
    const expenseGroups = groupTransactionsByCategory(thisMonthExpenses, categories);
    const totalSpent = expenseGroups.reduce((sum, group) => sum + group.spent, 0);
    const topCategories = expenseGroups.slice(0, 4).map((group, index) => ({
      ...group,
      color: ['#13895e', '#b48530', '#3e7cf0', '#8f65d6'][index] || '#95a0ae',
      share: totalSpent > 0 ? (group.spent / totalSpent) * 100 : 0,
    }));

    const recentTransactions = [...transactions]
      .sort((left, right) => right.date.localeCompare(left.date) || right.id - left.id)
      .slice(0, 8);

    return {
      thisMonthSummary,
      lastMonthSummary,
      balanceTrend,
      balanceLabel: usesSnapshots ? 'Recent snapshots' : 'Last 6 months',
      topCategories,
      recentTransactions,
      recurringExpenseTotal,
      transactionCount: thisMonthTransactions.length,
    };
  }, [
    categories,
    currentMonthKey,
    netWorth,
    netWorthTrend,
    previousMonthKey,
    selectedMonth.month,
    selectedMonth.year,
    selectedMonthEnd,
    transactions,
  ]);

  const incomeDelta = percentDelta(dashboardData.thisMonthSummary.income, dashboardData.lastMonthSummary.income);
  const expenseDelta = percentDelta(dashboardData.thisMonthSummary.expenses, dashboardData.lastMonthSummary.expenses);
  const greeting = `Welcome back${userName ? `, ${userName}` : ''}`;
  const topCategory = dashboardData.topCategories[0];
  const fallbackSummary = useMemo(() => {
    const lead = topCategory?.categoryName
      ? `${topCategory.categoryName} is driving the largest share of spending.`
      : 'No dominant expense category yet.';
    return `${isPrivateMode ? '••••' : formatCurrency(dashboardData.thisMonthSummary.income)} in, ${isPrivateMode ? '••••' : formatCurrency(dashboardData.thisMonthSummary.expenses)} out, leaving ${isPrivateMode ? '••••' : formatCurrency(dashboardData.thisMonthSummary.netFlow)} net flow. ${lead}`;
  }, [
    dashboardData.thisMonthSummary.expenses,
    dashboardData.thisMonthSummary.income,
    dashboardData.thisMonthSummary.netFlow,
    isPrivateMode,
    topCategory?.categoryName,
  ]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1">
      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-12 overflow-hidden rounded-[36px] p-0 xl:col-span-7">
          <div className="m-3 rounded-[30px] border border-border bg-[linear-gradient(135deg,rgba(255,244,238,1),rgba(255,255,255,1)_58%,rgba(240,247,243,1))] px-7 py-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
                  Overview
                </p>
                <h1 className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-text-primary">
                  {greeting}
                </h1>
                <p className="mt-2 text-sm leading-6 text-text-secondary">
                  Here&apos;s your money picture for {getMonthName(selectedMonth.month)}.
                </p>
              </div>

              <div className="rounded-full border border-border bg-white px-3 py-1.5 text-xs font-semibold text-text-secondary">
                {getMonthName(selectedMonth.month)} {selectedMonth.year}
              </div>
            </div>

            <div className="mt-8">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
                Total balance
              </p>
              <div className="mt-2 text-5xl font-semibold tracking-[-0.06em] text-text-primary numeric-display">
                <Amount value={netWorth} />
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button variant="primary" onClick={() => setActivePage('accounts')}>
                View wallets
              </Button>
              <Button variant="secondary" onClick={() => setActivePage('transactions')}>
                View transactions
              </Button>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-4">
              <div className="min-w-0 rounded-2xl border border-border bg-white px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-secondary">
                  Accounts
                </p>
                <p className="mt-2 truncate text-xl font-semibold text-text-primary numeric-display">{accounts.length}</p>
              </div>
              <div className="min-w-0 rounded-2xl border border-border bg-white px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-secondary">
                  Net flow
                </p>
                <div className="mt-2 truncate text-xl font-semibold text-text-primary numeric-display">
                  <Amount value={dashboardData.thisMonthSummary.netFlow} />
                </div>
              </div>
              <div className="min-w-0 rounded-2xl border border-border bg-white px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-secondary">
                  Transactions
                </p>
                <p className="mt-2 truncate text-xl font-semibold text-text-primary numeric-display">
                  {dashboardData.transactionCount}
                </p>
              </div>
              <div className="min-w-0 rounded-2xl border border-border bg-white px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-secondary">
                  Recurring
                </p>
                <div className="mt-2 truncate text-xl font-semibold text-text-primary numeric-display">
                  <Amount value={dashboardData.recurringExpenseTotal} />
                </div>
              </div>
            </div>
          </div>
        </Card>

        <div className="col-span-12 grid gap-4 md:grid-cols-2 xl:col-span-5">
          <MetricCard
            icon={<TrendingUp size={20} />}
            label="Income"
            amount={dashboardData.thisMonthSummary.income}
            delta={incomeDelta}
          />
          <MetricCard
            icon={<TrendingDown size={20} />}
            label="Expenses"
            amount={dashboardData.thisMonthSummary.expenses}
            delta={expenseDelta}
            inverse
          />
          <Card className="p-5 md:col-span-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
                  AI summary
                </p>
                <h2 className="mt-2 text-xl font-semibold text-text-primary">Monthly readout</h2>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent-subtle text-accent">
                <WandSparkles size={18} />
              </div>
            </div>

            <div className="mt-4 rounded-[24px] border border-border bg-surface-muted px-4 py-4 text-sm leading-6 text-text-secondary">
              {aiStatus === 'loading'
                ? 'Generating a summary for this month...'
                : aiStatus === 'ready'
                  ? aiSummary
                  : `${fallbackSummary} AI summary could not be loaded right now.`}
            </div>
          </Card>
        </div>

        <Card className="col-span-12 self-start p-6 xl:col-span-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
                Balance trend
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-text-primary">Balance over time</h2>
            </div>
            <div className="rounded-full border border-border bg-surface-muted px-3 py-1.5 text-xs font-semibold text-text-secondary">
              {dashboardData.balanceLabel}
            </div>
          </div>

          <div className="mt-5 h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dashboardData.balanceTrend} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
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
                <Tooltip content={<BalanceTooltip />} />
                <Line
                  type="monotone"
                  dataKey="balance"
                  stroke="var(--color-accent)"
                  strokeWidth={3}
                  dot={false}
                  strokeDasharray={isPrivateMode ? "4 4" : undefined}
                  activeDot={{ r: 5, fill: 'var(--color-accent)', stroke: '#fff', strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="col-span-12 self-start p-6 xl:col-span-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
                Spending mix
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-text-primary">Where money went</h2>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent-subtle text-accent">
              <CreditCard size={18} />
            </div>
          </div>

          <div className="mt-5 flex items-center justify-center">
            <div className="flex h-56 w-56 items-center justify-center">
              <svg width="224" height="224" viewBox="-12 -12 224 224" className="overflow-visible">
                {dashboardData.topCategories.map((category, index) => {
                  const radius = 76 - index * 18;
                  const circumference = 2 * Math.PI * radius;
                  return (
                    <g key={category.categoryName} transform="rotate(-90 100 100)">
                      <circle cx="100" cy="100" r={radius} fill="none" stroke="rgba(15,23,42,0.08)" strokeWidth="12" />
                      <circle
                        cx="100"
                        cy="100"
                        r={radius}
                        fill="none"
                        stroke={category.color}
                        strokeWidth="12"
                        strokeDasharray={`${(category.share / 100) * circumference} ${circumference}`}
                        strokeLinecap="round"
                      />
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>

          <div className="mt-2 space-y-2">
            {dashboardData.topCategories.length === 0 ? (
              <p className="text-sm text-text-secondary">No expenses recorded for this month yet.</p>
            ) : (
              dashboardData.topCategories.map((category) => (
                <div key={category.categoryName} className="flex items-center gap-3 rounded-2xl border border-border bg-surface-muted px-4 py-3">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: category.color }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-text-primary">{category.categoryName}</p>
                  </div>
                  <p className="text-sm font-semibold text-text-primary numeric-display">
                    {isPrivateMode ? '••%' : `${category.share.toFixed(1)}%`}
                  </p>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="col-span-12 p-0">
          <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
                Recent transactions
              </p>
              <h2 className="mt-1 text-xl font-semibold text-text-primary">Latest activity</h2>
            </div>

            <Button variant="secondary" onClick={() => setActivePage('transactions')}>
              View all
            </Button>
          </div>

          <div className="overflow-x-auto">
            {dashboardData.recentTransactions.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-text-secondary">
                Add a few transactions and Monet will surface them here.
              </div>
            ) : (
              <div className="min-w-[760px]">
                <div className="grid grid-cols-[1.8fr_1fr_1fr_0.9fr_0.9fr] gap-3 border-b border-border bg-surface-muted px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-text-secondary">
                  <span>Description</span>
                  <span>Category</span>
                  <span>Account</span>
                  <span>Date</span>
                  <span className="text-right">Amount</span>
                </div>

                {dashboardData.recentTransactions.map((transaction) => {
                  const positive = transaction.amount >= 0;
                  return (
                    <div
                      key={transaction.id}
                      className="grid grid-cols-[1.8fr_1fr_1fr_0.9fr_0.9fr] gap-3 border-b border-border px-5 py-3 text-sm"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={`flex h-7 w-7 items-center justify-center rounded-full ${positive ? 'bg-income-subtle text-income' : 'bg-expense-subtle text-expense'}`}>
                          {positive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                        </span>
                        <span className="truncate font-medium text-text-primary">
                          {transaction.note?.trim() || transaction.category_name}
                        </span>
                      </div>
                      <span className="truncate text-text-secondary">{transaction.category_name}</span>
                      <span className="truncate text-text-secondary">{transaction.account_name}</span>
                      <span className="text-text-secondary">{formatDateShort(transaction.date)}</span>
                      <div className={`text-right font-semibold numeric-display ${positive ? 'text-income' : 'text-expense'}`}>
                        <Amount value={transaction.amount} showSign />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
