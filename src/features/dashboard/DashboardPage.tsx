import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, Plus, ShieldAlert, Sparkles, Target } from 'lucide-react';
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { insightsRepository } from '../../lib/repositories/insightsRepository';
import { useUIStore } from '../../store/uiStore';
import { useAccountStore } from '../../store/accountStore';
import { useTransactionStore } from '../../store/transactionStore';
import { formatCurrency, formatDateShort, getCurrentMonth, getMonthName } from '../../lib/utils';

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.04 } },
};

const item = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0 },
};

const SPENDING_COLORS = ['#2E6F95', '#1F8A70', '#D97706', '#C2410C', '#7C3AED'];

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function monthDateFromOffset(year: number, month: number, offset: number): Date {
  return new Date(year, month - 1 + offset, 1);
}

function summarizeMonth(transactions: Array<{ date: string; amount: number }>, key: string) {
  let income = 0;
  let expense = 0;
  for (const txn of transactions) {
    if (!txn.date.startsWith(key)) continue;
    if (txn.amount >= 0) income += txn.amount;
    else expense += Math.abs(txn.amount);
  }
  return { income, expense, netFlow: income - expense };
}

export function DashboardPage({ userName }: { userName?: string }) {
  const { totalBalance, netWorthTrend, hasLoaded: accountsLoaded, fetchAccounts, fetchNetWorthTrend } = useAccountStore();
  const {
    transactions,
    monthlySpending,
    predictedEndOfMonthSpend,
    hasLoaded: transactionsLoaded,
    fetchTransactions,
    fetchMonthlySpending,
  } = useTransactionStore();
  const { openTransactionForm, setActivePage } = useUIStore();

  const [targetDate, setTargetDate] = useState(getCurrentMonth());
  const [monthStory, setMonthStory] = useState('Summarizing your month...');
  const [storyLoading, setStoryLoading] = useState(false);

  useEffect(() => {
    if (!accountsLoaded) fetchAccounts();
    if (!transactionsLoaded) fetchTransactions();
  }, [accountsLoaded, transactionsLoaded, fetchAccounts, fetchTransactions]);

  useEffect(() => {
    if (accountsLoaded) fetchNetWorthTrend();
  }, [accountsLoaded, totalBalance, transactions.length, fetchNetWorthTrend]);

  useEffect(() => {
    if (transactionsLoaded) fetchMonthlySpending(targetDate.year, targetDate.month);
  }, [transactionsLoaded, targetDate.year, targetDate.month, fetchMonthlySpending]);

  const currentMonthKey = monthKey(targetDate.year, targetDate.month);
  const previousMonthDate = monthDateFromOffset(targetDate.year, targetDate.month, -1);
  const previousMonthKey = monthKey(previousMonthDate.getFullYear(), previousMonthDate.getMonth() + 1);

  const currentSummary = useMemo(() => summarizeMonth(transactions, currentMonthKey), [transactions, currentMonthKey]);
  const previousSummary = useMemo(() => summarizeMonth(transactions, previousMonthKey), [transactions, previousMonthKey]);

  const savingsRate = currentSummary.income > 0 ? (currentSummary.netFlow / currentSummary.income) * 100 : 0;
  const spendingRate = currentSummary.income > 0 ? (currentSummary.expense / currentSummary.income) * 100 : 0;
  const previousSavingsRate = previousSummary.income > 0 ? (previousSummary.netFlow / previousSummary.income) * 100 : 0;
  const savingsRateDelta = savingsRate - previousSavingsRate;
  const forecastGap = predictedEndOfMonthSpend - currentSummary.expense;

  const netWorthMiniData = useMemo(() => {
    const base = netWorthTrend.length === 0
      ? [{ date: new Date().toISOString().split('T')[0], value: totalBalance }]
      : netWorthTrend;
    return base.slice(-45);
  }, [netWorthTrend, totalBalance]);

  const donutData = useMemo(() => {
    if (monthlySpending.length === 0) return [];
    return [...monthlySpending]
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
      .map((entry, idx) => ({ ...entry, fill: SPENDING_COLORS[idx % SPENDING_COLORS.length] }));
  }, [monthlySpending]);

  const topCategory = donutData[0];
  const topCategoryShare = currentSummary.expense > 0 && topCategory ? (topCategory.total / currentSummary.expense) * 100 : 0;
  const spendRunway = currentSummary.income - predictedEndOfMonthSpend;

  useEffect(() => {
    if (!transactionsLoaded) return;
    let active = true;

    const fetchStory = async () => {
      setStoryLoading(true);
      try {
        const summary = await insightsRepository.getMonthStory(targetDate.year, targetDate.month);
        if (active) setMonthStory(summary || 'No story available for this month yet.');
      } catch {
        if (active) setMonthStory('No story available for this month yet.');
      } finally {
        if (active) setStoryLoading(false);
      }
    };

    fetchStory();
    return () => {
      active = false;
    };
  }, [transactionsLoaded, targetDate.year, targetDate.month, transactions.length]);

  const prevMonth = () => {
    setTargetDate((prev) => (prev.month === 1 ? { year: prev.year - 1, month: 12 } : { year: prev.year, month: prev.month - 1 }));
  };

  const nextMonth = () => {
    setTargetDate((prev) => (prev.month === 12 ? { year: prev.year + 1, month: 1 } : { year: prev.year, month: prev.month + 1 }));
  };

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1 pb-4">
      <motion.div variants={item} className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">{userName ? `Hello ${userName}` : 'Dashboard'}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-text-primary">Financial standing</h1>
          <p className="mt-1 text-sm text-text-secondary">A compact read on stability, spending pressure, and what deserves attention.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-white/50 bg-white/70 px-1.5 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur-md">
            <button onClick={prevMonth} className="cursor-pointer rounded p-1 text-text-secondary transition-colors hover:bg-black/5 hover:text-text-primary" aria-label="Previous month">
              <ChevronLeft size={14} />
            </button>
            <span className="min-w-20 text-center text-xs font-semibold">
              {getMonthName(targetDate.month)} {targetDate.year}
            </span>
            <button onClick={nextMonth} className="cursor-pointer rounded p-1 text-text-secondary transition-colors hover:bg-black/5 hover:text-text-primary" aria-label="Next month">
              <ChevronRight size={14} />
            </button>
          </div>

          <Button variant="secondary" onClick={() => setActivePage('insights')} className="text-xs">
            Open Insights
          </Button>
          <Button icon={<Plus size={14} />} onClick={openTransactionForm} className="hidden text-xs sm:flex">
            Add Transaction
          </Button>
        </div>
      </motion.div>

      <div className="grid grid-cols-12 gap-3">
        <motion.div variants={item} className="col-span-12 lg:col-span-6">
          <Card className="rounded-[24px] p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-accent-subtle text-accent">
                  <Sparkles size={15} />
                </span>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.12em] text-text-secondary">AI Summary</p>
                  <p className="text-xs text-text-secondary">Short monthly readout</p>
                </div>
              </div>
            </div>
            <p className={`mt-3 text-sm leading-6 text-text-primary ${storyLoading ? 'animate-pulse' : ''}`}>{monthStory}</p>
          </Card>
        </motion.div>

        <motion.div variants={item} className="col-span-12 lg:col-span-6">
          <Card className="rounded-[24px] p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.12em] text-text-secondary">Net Worth</p>
                <p className={`mt-1 text-2xl font-semibold numeric-display ${totalBalance >= 0 ? 'text-text-primary' : 'text-expense'}`}>
                  {formatCurrency(totalBalance)}
                </p>
              </div>
              <p className="text-[11px] text-text-secondary">Last 45 days</p>
            </div>
            <div className="mt-2 h-[120px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={netWorthMiniData} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dashboardWorth" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#A88B4A" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="#A88B4A" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tickFormatter={formatDateShort} hide />
                  <YAxis hide />
                  <Tooltip
                    cursor={{ stroke: 'rgba(168,139,74,0.35)', strokeWidth: 1, strokeDasharray: '4 4' }}
                    labelFormatter={(label) => formatDateShort(String(label))}
                    formatter={(value) => [formatCurrency(Number(value)), 'Net worth']}
                    contentStyle={{ borderRadius: 10, border: '1px solid rgba(255,255,255,0.8)', backgroundColor: 'rgba(255,255,255,0.92)' }}
                  />
                  <Area type="monotone" dataKey="value" stroke="#A88B4A" strokeWidth={2.2} fill="url(#dashboardWorth)" dot={false} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </motion.div>
      </div>

      <div className="grid grid-cols-12 items-start gap-3">
        <motion.div variants={item} className="col-span-12 xl:col-span-7">
          <div className="grid grid-cols-12 gap-3">
            <Card className="col-span-12 sm:col-span-6 rounded-[24px] p-4">
              <p className="text-[11px] uppercase tracking-[0.12em] text-text-secondary">Monthly Net Flow</p>
              <p className={`mt-2 text-2xl font-semibold numeric-display ${currentSummary.netFlow >= 0 ? 'text-income' : 'text-expense'}`}>
                {formatCurrency(currentSummary.netFlow)}
              </p>
              <p className="mt-2 text-xs leading-5 text-text-secondary">What you kept after income and spending this month.</p>
            </Card>

            <Card className="col-span-12 sm:col-span-6 rounded-[24px] p-4">
              <p className="text-[11px] uppercase tracking-[0.12em] text-text-secondary">Savings Rate</p>
              <p className={`mt-2 text-2xl font-semibold numeric-display ${savingsRate >= 0 ? 'text-income' : 'text-expense'}`}>
                {savingsRate.toFixed(1)}%
              </p>
              <div className={`mt-2 flex items-center gap-1 text-xs ${savingsRateDelta >= 0 ? 'text-income' : 'text-expense'}`}>
                {savingsRateDelta >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                <span>{Math.abs(savingsRateDelta).toFixed(1)} pts vs last month</span>
              </div>
            </Card>

            <Card className="col-span-12 sm:col-span-6 rounded-[24px] p-4">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-warning-subtle text-warning">
                  <ShieldAlert size={15} />
                </span>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.12em] text-text-secondary">Spending Pressure</p>
                  <p className="mt-1 text-lg font-semibold numeric-display text-text-primary">{spendingRate.toFixed(1)}%</p>
                </div>
              </div>
              <p className="mt-3 text-xs leading-5 text-text-secondary">
                {topCategory ? `${topCategory.category_name} is your largest category at ${topCategoryShare.toFixed(0)}% of total spending.` : 'No dominant spending category yet this month.'}
              </p>
            </Card>

            <Card className="col-span-12 sm:col-span-6 rounded-[24px] p-4">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-income-subtle text-income">
                  <Target size={15} />
                </span>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.12em] text-text-secondary">Month-End Outlook</p>
                  <p className={`mt-1 text-lg font-semibold numeric-display ${spendRunway >= 0 ? 'text-income' : 'text-expense'}`}>
                    {formatCurrency(spendRunway)}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-xs leading-5 text-text-secondary">
                Forecast spend is {formatCurrency(predictedEndOfMonthSpend)}.
                {' '}
                {forecastGap > 0 ? `${formatCurrency(forecastGap)} more than spent so far.` : 'You are already near your projected pace.'}
              </p>
            </Card>
          </div>
        </motion.div>

        <motion.div variants={item} className="col-span-12 xl:col-span-5">
          <Card className="rounded-[24px] p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text-primary">Spending Mix</h2>
              <span className="text-[11px] text-text-secondary">Top categories</span>
            </div>

            {donutData.length === 0 ? (
              <div className="flex h-[250px] items-center justify-center text-center">
                <p className="max-w-[220px] text-xs leading-5 text-text-secondary">No expense activity this month yet, so category pressure is still blank.</p>
              </div>
            ) : (
              <div className="mt-2 grid h-[250px] grid-cols-[140px_1fr] items-center gap-3">
                <div className="h-[160px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={donutData} dataKey="total" nameKey="category_name" innerRadius={36} outerRadius={62} paddingAngle={2}>
                        {donutData.map((slice) => (
                          <Cell key={slice.category_name} fill={slice.fill} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="space-y-2">
                  {donutData.map((entry) => {
                    const pct = currentSummary.expense > 0 ? (entry.total / currentSummary.expense) * 100 : 0;
                    return (
                      <div key={entry.category_name} className="rounded-2xl border border-white/55 bg-white/55 px-3 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-2 text-sm text-text-primary">
                            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.fill }} />
                            <span className="truncate">{entry.category_name}</span>
                          </span>
                          <span className="text-xs font-semibold text-text-secondary numeric-text">{pct.toFixed(0)}%</span>
                        </div>
                        <p className="mt-1 text-xs text-text-secondary numeric-text">{formatCurrency(entry.total)}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}
