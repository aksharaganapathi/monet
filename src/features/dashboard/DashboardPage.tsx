import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Plus, Sparkles, Target } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { insightsRepository } from '../../lib/repositories/insightsRepository';
import {
  calculateCashRunway,
  calculateHealthScore,
  calculateMonthlySavingsRate,
  calculateNetWorth,
  calculateTrailingAverageMonthlySpend,
  getSpendingConcentration,
  summarizeCashFlow,
} from '../../lib/finance';
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

type Point = { x: number; y: number };
type FocusTone = 'critical' | 'warn' | 'ok' | 'info';

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getFirstSentence(value: string): string {
  const match = value.match(/.+?[.!?](\s|$)/);
  return match?.[0]?.trim() || value.trim();
}

function buildSparklinePoints(values: number[], width: number, height: number, padding = 4): Point[] {
  if (values.length === 0) {
    return [];
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  return values.map((value, index) => ({
    x: padding + (index / Math.max(values.length - 1, 1)) * (width - padding * 2),
    y: height - padding - ((value - min) / span) * (height - padding * 2),
  }));
}

function buildLinePath(points: Point[]): string {
  if (points.length === 0) {
    return '';
  }

  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

function toneColor(tone: 'positive' | 'gold' | 'warning' | 'negative'): string {
  if (tone === 'positive') return 'var(--color-income)';
  if (tone === 'warning') return 'var(--color-warning)';
  if (tone === 'negative') return 'var(--color-expense)';
  return 'var(--color-accent)';
}

function pillToneClasses(tone: 'positive' | 'warning' | 'negative') {
  if (tone === 'positive') {
    return 'bg-income-subtle text-income';
  }

  if (tone === 'warning') {
    return 'bg-warning-subtle text-warning';
  }

  return 'bg-expense-subtle text-expense';
}

function focusToneStyles(tone: FocusTone) {
  if (tone === 'critical') {
    return {
      backgroundColor: 'var(--color-expense-subtle)',
      borderLeftColor: 'var(--color-expense)',
    };
  }

  if (tone === 'warn') {
    return {
      backgroundColor: '#FFFBF0',
      borderLeftColor: 'var(--color-warning)',
    };
  }

  if (tone === 'ok') {
    return {
      backgroundColor: '#F0FAF5',
      borderLeftColor: 'var(--color-income)',
    };
  }

  return {
    backgroundColor: '#F0F4FF',
    borderLeftColor: 'var(--color-info)',
  };
}

function Sparkline({
  values,
  width,
  height,
  color,
  dashed = false,
}: {
  values: number[];
  width: number;
  height: number;
  color: string;
  dashed?: boolean;
}) {
  const points = buildSparklinePoints(values, width, height);
  const path = buildLinePath(points);

  if (!path) {
    return null;
  }

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="w-full">
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeDasharray={dashed ? '5 5' : undefined}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ProgressRing({ score, tone }: { score: number; tone: 'positive' | 'gold' | 'warning' | 'negative' }) {
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (score / 100) * circumference;
  const color = toneColor(tone);

  return (
    <div className="relative h-28 w-28">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--color-border-subtle)" strokeWidth="8" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="numeric-display text-3xl font-semibold text-text-primary">{score}</span>
        <span className="text-[11px] uppercase tracking-[0.18em] text-text-secondary">Score</span>
      </div>
    </div>
  );
}

export function DashboardPage({ userName }: { userName?: string }) {
  const {
    accounts,
    totalBalance,
    netWorthTrend,
    hasLoaded: accountsLoaded,
    fetchAccounts,
    fetchNetWorthTrend,
  } = useAccountStore();
  const {
    transactions,
    hasLoaded: transactionsLoaded,
    fetchTransactions,
  } = useTransactionStore();
  const { openTransactionForm, setActivePage } = useUIStore();

  const [targetDate, setTargetDate] = useState(getCurrentMonth());
  const [monthStory, setMonthStory] = useState('Summarizing your month...');
  const [storyLoading, setStoryLoading] = useState(false);
  const [isStoryExpanded, setIsStoryExpanded] = useState(false);

  useEffect(() => {
    if (!accountsLoaded) {
      void fetchAccounts();
    }
    if (!transactionsLoaded) {
      void fetchTransactions();
    }
  }, [accountsLoaded, transactionsLoaded, fetchAccounts, fetchTransactions]);

  useEffect(() => {
    if (accountsLoaded) {
      void fetchNetWorthTrend();
    }
  }, [accountsLoaded, totalBalance, fetchNetWorthTrend]);

  useEffect(() => {
    if (!transactionsLoaded) {
      return;
    }

    let active = true;
    setIsStoryExpanded(false);

    const fetchStory = async () => {
      setStoryLoading(true);
      try {
        const summary = await insightsRepository.getMonthStory(targetDate.year, targetDate.month);
        if (active) {
          setMonthStory(summary || 'No story available for this month yet.');
        }
      } catch {
        if (active) {
          setMonthStory('No story available for this month yet.');
        }
      } finally {
        if (active) {
          setStoryLoading(false);
        }
      }
    };

    void fetchStory();

    return () => {
      active = false;
    };
  }, [transactionsLoaded, targetDate.month, targetDate.year]);

  const currentMonthKey = monthKey(targetDate.year, targetDate.month);
  const currentMonthTransactions = useMemo(
    () => transactions.filter((transaction) => transaction.date.startsWith(currentMonthKey)),
    [transactions, currentMonthKey],
  );

  const currentSummary = useMemo(
    () => summarizeCashFlow(currentMonthTransactions),
    [currentMonthTransactions],
  );

  const computedNetWorth = useMemo(
    () => (accounts.length > 0 ? calculateNetWorth(accounts) : totalBalance),
    [accounts, totalBalance],
  );

  const positiveBalanceTotal = useMemo(
    () => sumPositiveBalances(accounts),
    [accounts],
  );

  const trailingSpend = useMemo(
    () => calculateTrailingAverageMonthlySpend(
      transactions,
      3,
      new Date(targetDate.year, targetDate.month - 1, 1),
    ),
    [targetDate.month, targetDate.year, transactions],
  );

  const savingsRate = useMemo(
    () => calculateMonthlySavingsRate(currentSummary.income, currentSummary.expenses),
    [currentSummary.expenses, currentSummary.income],
  );

  const cashRunway = useMemo(
    () => calculateCashRunway(positiveBalanceTotal, trailingSpend.average),
    [positiveBalanceTotal, trailingSpend.average],
  );

  const concentration = useMemo(
    () => getSpendingConcentration(currentMonthTransactions),
    [currentMonthTransactions],
  );

  const healthScore = useMemo(
    () =>
      calculateHealthScore({
        savingsRate,
        cashRunwayMonths: cashRunway,
        spendingConcentrationShare: concentration.share,
        hasIncome: currentSummary.income > 0,
        transactionCount: currentMonthTransactions.length,
      }),
    [cashRunway, concentration.share, currentMonthTransactions.length, currentSummary.income, savingsRate],
  );

  const storyPreview = useMemo(() => getFirstSentence(monthStory), [monthStory]);

  const netWorthSparklineValues = useMemo(
    () => netWorthTrend.slice(-45).map((point) => point.value),
    [netWorthTrend],
  );

  const hasMultiMonthTrend = useMemo(
    () => new Set(netWorthTrend.map((point) => point.date.slice(0, 7))).size > 1,
    [netWorthTrend],
  );

  const hasSevenDaysOfTrend = useMemo(
    () => new Set(netWorthTrend.map((point) => point.date)).size >= 7,
    [netWorthTrend],
  );

  const progressWidth = clamp(Math.max(savingsRate, 0), 0, 100);
  const savingsBadgeText =
    savingsRate >= 0 ? `${savingsRate.toFixed(1)}% saved` : `${Math.abs(savingsRate).toFixed(1)}% overspent`;

  const runwayBadge = getRunwayBadge(cashRunway);
  const focusAreas = useMemo(
    () =>
      buildFocusAreas({
        savingsRate,
        cashRunway,
        concentrationShare: concentration.share,
        concentrationCategory: concentration.categoryName,
        transactionCount: currentMonthTransactions.length,
        hasIncome: currentSummary.income > 0,
      }).slice(0, 3),
    [cashRunway, concentration.categoryName, concentration.share, currentMonthTransactions.length, currentSummary.income, savingsRate],
  );

  const prevMonth = () => {
    setTargetDate((prev) =>
      prev.month === 1 ? { year: prev.year - 1, month: 12 } : { year: prev.year, month: prev.month - 1 },
    );
  };

  const nextMonth = () => {
    setTargetDate((prev) =>
      prev.month === 12 ? { year: prev.year + 1, month: 1 } : { year: prev.year, month: prev.month + 1 },
    );
  };

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1 pb-4">
      <motion.div variants={item} className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
            {userName ? `Hello ${userName}` : 'Dashboard'}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-text-primary">Financial standing</h1>
          <p className="mt-1 text-sm text-text-secondary">
            A calm read on the month: what you kept, how much buffer you have, and where attention belongs.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="surface-card flex items-center gap-2 rounded-lg px-1.5 py-1">
            <button onClick={prevMonth} className="rounded-md p-1 text-text-secondary transition-colors hover:bg-accent-subtle hover:text-text-primary" aria-label="Previous month">
              <ChevronLeft size={14} />
            </button>
            <span className="min-w-24 text-center text-xs font-semibold text-text-primary">
              {getMonthName(targetDate.month)} {targetDate.year}
            </span>
            <button onClick={nextMonth} className="rounded-md p-1 text-text-secondary transition-colors hover:bg-accent-subtle hover:text-text-primary" aria-label="Next month">
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
        <motion.div variants={item} className="col-span-12 md:col-span-4">
          <Card className="h-full rounded-xl p-5">
            <p className="text-[11px] uppercase tracking-[0.16em] text-text-secondary">Net Worth</p>
            <p className="numeric-display mt-3 text-3xl font-semibold text-accent">{formatCurrency(computedNetWorth)}</p>
            <p className="mt-1 text-sm text-text-secondary">across {accounts.length} account{accounts.length === 1 ? '' : 's'}</p>
            {hasMultiMonthTrend && netWorthSparklineValues.length > 1 ? (
              <div className="mt-5">
                <Sparkline values={netWorthSparklineValues} width={280} height={54} color="var(--color-accent)" />
              </div>
            ) : (
              <p className="mt-5 text-xs text-text-tertiary">Add more history to unlock a longer net worth trend.</p>
            )}
          </Card>
        </motion.div>

        <motion.div variants={item} className="col-span-12 md:col-span-4">
          <Card className="h-full rounded-xl p-5">
            <p className="text-[11px] uppercase tracking-[0.16em] text-text-secondary">Monthly Net Flow</p>
            <p className={`numeric-display mt-3 text-3xl font-semibold ${currentSummary.netFlow >= 0 ? 'text-income' : 'text-expense'}`}>
              {formatCurrency(currentSummary.netFlow)}
            </p>
            <p className="mt-1 text-sm text-text-secondary">kept after expenses</p>
            <div className="mt-5 h-1 w-full overflow-hidden rounded-full bg-surface-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${progressWidth}%`,
                  background: 'linear-gradient(90deg, var(--color-income) 0%, var(--color-accent) 100%)',
                }}
              />
            </div>
            <span className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${savingsRate >= 0 ? 'bg-income-subtle text-income' : 'bg-expense-subtle text-expense'}`}>
              {savingsBadgeText}
            </span>
          </Card>
        </motion.div>

        <motion.div variants={item} className="col-span-12 md:col-span-4">
          <Card className="h-full rounded-xl p-5">
            <p className="text-[11px] uppercase tracking-[0.16em] text-text-secondary">Cash Runway</p>
            <p className="numeric-display mt-3 text-3xl font-semibold text-text-primary">
              {cashRunway == null ? 'N/A' : `${cashRunway.toFixed(1)} mo`}
            </p>
            <div className="mt-3">
              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${runwayBadge.className}`}>
                {runwayBadge.label}
              </span>
            </div>
            <p className="mt-3 text-sm text-text-secondary">estimated months of expenses covered</p>
            {trailingSpend.monthCount > 0 && trailingSpend.monthCount < 3 && (
              <p className="mt-2 text-xs text-text-tertiary">Based on {trailingSpend.monthCount} month{trailingSpend.monthCount === 1 ? '' : 's'} of spending history.</p>
            )}
            {trailingSpend.monthCount === 0 && (
              <p className="mt-2 text-xs text-text-tertiary">Add spending history to estimate a runway.</p>
            )}
          </Card>
        </motion.div>
      </div>

      <motion.div variants={item}>
        <Card className="rounded-xl p-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-5">
              <ProgressRing score={healthScore.score} tone={healthScore.tone} />
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-text-secondary">Financial Health Score</p>
                <p className="mt-2 text-3xl font-semibold text-text-primary">{healthScore.band}</p>
                <p className="mt-2 max-w-xl text-sm text-text-secondary">
                  Built from savings pace, cash runway, spending concentration, income coverage, and data depth.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 lg:max-w-[48%] lg:justify-end">
              {healthScore.signals.map((signal) => (
                <button
                  key={signal.key}
                  type="button"
                  onClick={() => setActivePage('insights')}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${pillToneClasses(signal.tone)} hover:brightness-95`}
                >
                  {signal.label}
                </button>
              ))}
            </div>
          </div>
        </Card>
      </motion.div>

      <div className="grid grid-cols-12 gap-3">
        <motion.div variants={item} className="col-span-12 xl:col-span-8">
          <div className="grid gap-3">
            <Card className="rounded-xl p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent-subtle text-accent">
                    <Sparkles size={18} />
                  </span>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.16em] text-text-secondary">AI Summary</p>
                    <p className="text-sm text-text-secondary">A short monthly readout in plain language.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsStoryExpanded((current) => !current)}
                  className="text-sm font-medium text-accent transition-colors hover:text-accent-hover"
                >
                  {isStoryExpanded ? 'Show less' : 'Read more'}
                </button>
              </div>

              <p className={`mt-4 text-sm leading-6 text-text-primary ${storyLoading ? 'animate-pulse' : ''}`}>
                {isStoryExpanded ? monthStory : storyPreview}
              </p>
            </Card>

            <Card className="rounded-xl p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-text-secondary">Net Worth Trend</p>
                  <p className="mt-1 text-sm text-text-secondary">Track your balance snapshots over time.</p>
                </div>
                <span className="text-xs text-text-tertiary">
                  {netWorthTrend.length > 0 ? `${netWorthTrend.length} snapshots` : 'No history yet'}
                </span>
              </div>

              {hasSevenDaysOfTrend ? (
                <div className="mt-6">
                  <div className="h-56 rounded-xl bg-surface-muted px-4 py-6">
                    <Sparkline values={netWorthTrend.map((point) => point.value)} width={760} height={170} color="var(--color-accent)" />
                  </div>
                  <div className="mt-4 flex items-center justify-between text-xs text-text-secondary">
                    <span>{formatDateShort(netWorthTrend[0].date)}</span>
                    <span>{formatDateShort(netWorthTrend[netWorthTrend.length - 1].date)}</span>
                  </div>
                </div>
              ) : (
                <div className="mt-6 rounded-xl bg-surface-muted px-5 py-8">
                  <Sparkline
                    values={[2, 3, 3.5, 4, 4.2, 4.4, 4.8]}
                    width={760}
                    height={88}
                    color="var(--color-accent)"
                    dashed
                  />
                  <p className="mt-6 text-sm text-text-secondary">
                    Track your net worth over time — check back after a week of use.
                  </p>
                </div>
              )}
            </Card>
          </div>
        </motion.div>

        <motion.div variants={item} className="col-span-12 xl:col-span-4">
          <Card className="rounded-xl p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-text-secondary">Focus Areas</p>
                <h2 className="mt-1 text-lg font-semibold text-text-primary">What deserves attention</h2>
              </div>
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-info-subtle text-info">
                <Target size={18} />
              </span>
            </div>

            <div className="mt-5 space-y-3">
              {focusAreas.map((focus) => (
                <div
                  key={focus.title}
                  className="rounded-xl border-l-[3px] px-4 py-3"
                  style={focusToneStyles(focus.tone)}
                >
                  <p className="text-[13px] font-medium text-text-primary">{focus.title}</p>
                  <p className="mt-1 text-[12px] leading-5 text-text-secondary">{focus.description}</p>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setActivePage('insights')}
              className="mt-5 text-sm font-medium text-accent transition-colors hover:text-accent-hover"
            >
              See full insights →
            </button>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}

function sumPositiveBalances(accounts: Array<{ balance: number }>): number {
  return accounts.filter((account) => account.balance > 0).reduce((total, account) => total + account.balance, 0);
}

function getRunwayBadge(runway: number | null): { label: string; className: string } {
  if (runway == null) {
    return { label: 'Building history', className: 'bg-info-subtle text-info' };
  }

  if (runway >= 3) {
    return { label: 'Healthy buffer', className: 'bg-income-subtle text-income' };
  }

  if (runway >= 1) {
    return { label: 'Watch liquidity', className: 'bg-warning-subtle text-warning' };
  }

  return { label: 'Urgent buffer gap', className: 'bg-expense-subtle text-expense' };
}

function buildFocusAreas({
  savingsRate,
  cashRunway,
  concentrationShare,
  concentrationCategory,
  transactionCount,
  hasIncome,
}: {
  savingsRate: number;
  cashRunway: number | null;
  concentrationShare: number;
  concentrationCategory: string | null;
  transactionCount: number;
  hasIncome: boolean;
}): Array<{ title: string; description: string; tone: FocusTone }> {
  const items: Array<{ title: string; description: string; tone: FocusTone }> = [];

  if (!hasIncome) {
    items.push({
      title: 'No income recorded',
      description: 'This month has expenses but no income yet, so cash-flow readings are incomplete.',
      tone: 'critical',
    });
  }

  if (cashRunway != null) {
    if (cashRunway < 1) {
      items.push({
        title: 'Cash runway is short',
        description: `Current positive balances cover about ${cashRunway.toFixed(1)} months of recent spending.`,
        tone: 'critical',
      });
    } else if (cashRunway < 3) {
      items.push({
        title: 'Liquidity needs attention',
        description: `You have roughly ${cashRunway.toFixed(1)} months of expenses covered right now.`,
        tone: 'warn',
      });
    } else {
      items.push({
        title: 'Liquidity looks healthy',
        description: `You currently have about ${cashRunway.toFixed(1)} months of expense coverage.`,
        tone: 'ok',
      });
    }
  }

  if (concentrationShare > 50 && concentrationCategory) {
    items.push({
      title: 'Spending is concentrated',
      description: `${concentrationCategory} accounts for ${concentrationShare.toFixed(0)}% of expenses this month.`,
      tone: 'critical',
    });
  } else if (concentrationShare >= 40 && concentrationCategory) {
    items.push({
      title: 'One category is dominating',
      description: `${concentrationCategory} is taking ${concentrationShare.toFixed(0)}% of expenses this month.`,
      tone: 'warn',
    });
  }

  if (savingsRate >= 35) {
    items.push({
      title: 'Savings pace is strong',
      description: `You are keeping ${savingsRate.toFixed(1)}% of income after expenses this month.`,
      tone: 'ok',
    });
  } else if (hasIncome && savingsRate < 10) {
    items.push({
      title: 'Savings rate is compressed',
      description: `Only ${savingsRate.toFixed(1)}% of income remains after expenses this month.`,
      tone: 'warn',
    });
  }

  if (transactionCount < 5) {
    items.push({
      title: 'Data is still forming',
      description: 'A few more transactions will make health signals and trend reads more reliable.',
      tone: 'info',
    });
  }

  if (items.length === 0) {
    items.push({
      title: 'Patterns look steady',
      description: 'Your current data does not show an urgent risk signal this month.',
      tone: 'ok',
    });
  }

  const severity: Record<FocusTone, number> = {
    critical: 0,
    warn: 1,
    info: 2,
    ok: 3,
  };

  return items.sort((left, right) => severity[left.tone] - severity[right.tone]);
}
