import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Sparkles, Target } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { insightsRepository } from '../../lib/repositories/insightsRepository';
import {
  buildSankeyData,
  calculateCashRunway,
  calculateHealthScore,
  calculateMonthlySavingsRate,
  calculateNetWorth,
  calculateTrailingAverageMonthlySpend,
  getSpendingConcentration,
  summarizeCashFlow,
} from '../../lib/finance';
import { formatCurrency, formatDateShort } from '../../lib/utils';
import { useAccountStore } from '../../store/accountStore';
import { useBudgetStore } from '../../store/budgetStore';
import { useCategoryStore } from '../../store/categoryStore';
import { useTransactionStore } from '../../store/transactionStore';
import { useUIStore } from '../../store/uiStore';

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.04 } },
};

const item = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0 },
};

type FocusTone = 'critical' | 'warn' | 'ok' | 'info';
type Point = { x: number; y: number };

const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const firstSentence = (value: string) => value.match(/.+?[.!?](\s|$)/)?.[0]?.trim() || value.trim();

function sparklinePath(values: number[], width: number, height: number) {
  if (!values.length) return '';

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points: Point[] = values.map((value, index) => ({
    x: 4 + (index / Math.max(values.length - 1, 1)) * (width - 8),
    y: height - 4 - ((value - min) / span) * (height - 8),
  }));

  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

function toneColor(tone: 'positive' | 'gold' | 'warning' | 'negative') {
  if (tone === 'positive') return 'var(--color-income)';
  if (tone === 'warning') return 'var(--color-warning)';
  if (tone === 'negative') return 'var(--color-expense)';
  return 'var(--color-accent)';
}

function ProgressRing({
  score,
  tone,
}: {
  score: number;
  tone: 'positive' | 'gold' | 'warning' | 'negative';
}) {
  const radius = 46;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="relative h-28 w-28">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="var(--color-border-subtle)"
          strokeWidth="8"
        />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke={toneColor(tone)}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - (score / 100) * circumference}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="numeric-display text-3xl font-semibold text-text-primary">{score}</span>
        <span className="text-[11px] uppercase tracking-[0.18em] text-text-secondary">Score</span>
      </div>
    </div>
  );
}

function Sparkline({ values, dashed = false }: { values: number[]; dashed?: boolean }) {
  const path = sparklinePath(values, 760, 88);

  if (!path) return null;

  return (
    <svg viewBox="0 0 760 88" className="w-full">
      <path
        d={path}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={dashed ? '5 5' : undefined}
      />
    </svg>
  );
}

function SankeyCard({ sankeyData }: { sankeyData: ReturnType<typeof buildSankeyData> }) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  if (sankeyData.state === 'empty') {
    return (
      <div className="mt-6 rounded-xl bg-surface-muted px-6 py-10 text-center">
        <svg viewBox="0 0 180 90" className="mx-auto h-24 w-44 text-text-tertiary">
          <path
            d="M18 65h44c10 0 18-8 18-18s8-18 18-18h52"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="5 5"
          />
          <rect x="18" y="22" width="26" height="46" rx="6" fill="none" stroke="currentColor" strokeWidth="2" />
          <rect x="136" y="18" width="26" height="18" rx="5" fill="none" stroke="currentColor" strokeWidth="2" />
          <rect x="136" y="44" width="26" height="24" rx="5" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
        <p className="mt-4 text-sm text-text-secondary">Add more transactions to see your money flow.</p>
      </div>
    );
  }

  const chartWidth = 760;
  const chartHeight = 260;
  const sourceX = 24;
  const sourceWidth = 92;
  const targetX = 628;
  const targetWidth = 108;
  const targets = sankeyData.nodes.filter((node) => node.id !== 'income');
  const gap = 10;
  const availableHeight = chartHeight - gap * Math.max(targets.length - 1, 0);
  const nodeLookup = new Map(sankeyData.nodes.map((node) => [node.id, node]));

  let targetY = 0;
  let sourceY = 0;
  const layout = targets.map((node) => {
    const sourceHeight = (node.value / (sankeyData.totalIncome || 1)) * chartHeight;
    const height = Math.max((node.value / (sankeyData.totalIncome || 1)) * availableHeight, 14);
    const next = {
      ...node,
      targetTop: targetY,
      targetBottom: targetY + height,
      sourceTop: sourceY,
      sourceBottom: sourceY + sourceHeight,
    };
    targetY += height + gap;
    sourceY += sourceHeight;
    return next;
  });

  const hovered = sankeyData.links.find((link) => link.id === hoveredId) ?? null;
  const hoveredLabel = hovered ? nodeLookup.get(hovered.target)?.label ?? 'Flow' : null;

  return (
    <div className="mt-6">
      <div className="relative overflow-x-auto rounded-xl bg-surface-muted px-5 py-5">
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="min-w-[680px] w-full">
          <rect x={sourceX} y={0} width={sourceWidth} height={chartHeight} rx={10} fill="var(--color-accent-subtle)" stroke="var(--color-accent)" strokeWidth="1" />
          <text x={sourceX + 14} y={24} fill="var(--color-text-primary)" fontSize="12" fontWeight="600">Income</text>
          <text x={sourceX + 14} y={42} fill="var(--color-text-secondary)" fontSize="12">{formatCurrency(sankeyData.totalIncome)}</text>
          {layout.map((node) => {
            const link = sankeyData.links.find((entry) => entry.target === node.id);
            if (!link) return null;

            const curveX = sourceX + sourceWidth + (targetX - (sourceX + sourceWidth)) * 0.5;
            const path = [
              `M ${sourceX + sourceWidth} ${node.sourceTop}`,
              `C ${curveX} ${node.sourceTop}, ${curveX} ${node.targetTop}, ${targetX} ${node.targetTop}`,
              `L ${targetX} ${node.targetBottom}`,
              `C ${curveX} ${node.targetBottom}, ${curveX} ${node.sourceBottom}, ${sourceX + sourceWidth} ${node.sourceBottom}`,
              'Z',
            ].join(' ');

            const isHovered = hoveredId === link.id;

            return (
              <g key={link.id}>
                <path d={path} fill={link.color} opacity={isHovered ? 0.4 : 0.18} onMouseEnter={() => setHoveredId(link.id)} onMouseLeave={() => setHoveredId(null)} />
                <rect x={targetX} y={node.targetTop} width={targetWidth} height={Math.max(node.targetBottom - node.targetTop, 14)} rx={8} fill={link.color} opacity={node.type === 'deficit' ? 0.18 : 0.12} stroke={link.color} strokeWidth="1" />
                <text x={targetX + 12} y={node.targetTop + 18} fill="var(--color-text-primary)" fontSize="12" fontWeight="600">{node.label}</text>
                <text x={targetX + 12} y={node.targetTop + 35} fill="var(--color-text-secondary)" fontSize="12">{formatCurrency(link.value)}</text>
              </g>
            );
          })}
        </svg>

        {hovered && (
          <div className="chart-tooltip absolute right-4 top-4 rounded-xl px-3 py-2 text-xs">
            <p className="font-semibold text-text-primary">{hoveredLabel}</p>
            <p className="mt-1 text-text-secondary">{formatCurrency(hovered.value)} • {hovered.percentageOfIncome.toFixed(1)}% of income</p>
          </div>
        )}
      </div>

      <p className="mt-4 text-sm text-text-secondary">{sankeyData.insight}</p>
    </div>
  );
}

function runwayBadge(runway: number | null) {
  if (runway == null) return { label: 'Building history', className: 'bg-info-subtle text-info' };
  if (runway >= 3) return { label: 'Healthy buffer', className: 'bg-income-subtle text-income' };
  if (runway >= 1) return { label: 'Watch liquidity', className: 'bg-warning-subtle text-warning' };
  return { label: 'Urgent buffer gap', className: 'bg-expense-subtle text-expense' };
}

function buildFocusAreas(input: {
  savingsRate: number;
  cashRunway: number | null;
  concentrationShare: number;
  concentrationCategory: string | null;
  transactionCount: number;
  hasIncome: boolean;
}) {
  const items: Array<{ title: string; description: string; tone: FocusTone }> = [];

  if (!input.hasIncome) {
    items.push({
      title: 'No income recorded',
      description: 'This month has expenses but no income yet, so cash-flow readings are incomplete.',
      tone: 'critical',
    });
  }

  if (input.cashRunway != null) {
    if (input.cashRunway < 1) {
      items.push({
        title: 'Cash runway is short',
        description: `Current positive balances cover about ${input.cashRunway.toFixed(1)} months of recent spending.`,
        tone: 'critical',
      });
    } else if (input.cashRunway < 3) {
      items.push({
        title: 'Liquidity needs attention',
        description: `You have roughly ${input.cashRunway.toFixed(1)} months of expenses covered right now.`,
        tone: 'warn',
      });
    } else {
      items.push({
        title: 'Liquidity looks healthy',
        description: `You currently have about ${input.cashRunway.toFixed(1)} months of expense coverage.`,
        tone: 'ok',
      });
    }
  }

  if (input.concentrationShare > 50 && input.concentrationCategory) {
    items.push({
      title: 'Spending is concentrated',
      description: `${input.concentrationCategory} accounts for ${input.concentrationShare.toFixed(0)}% of expenses this month.`,
      tone: 'critical',
    });
  } else if (input.concentrationShare >= 40 && input.concentrationCategory) {
    items.push({
      title: 'One category is dominating',
      description: `${input.concentrationCategory} is taking ${input.concentrationShare.toFixed(0)}% of expenses this month.`,
      tone: 'warn',
    });
  }

  if (input.savingsRate >= 35) {
    items.push({
      title: 'Savings pace is strong',
      description: `You are keeping ${input.savingsRate.toFixed(1)}% of income after expenses this month.`,
      tone: 'ok',
    });
  } else if (input.hasIncome && input.savingsRate < 10) {
    items.push({
      title: 'Savings rate is compressed',
      description: `Only ${input.savingsRate.toFixed(1)}% of income remains after expenses this month.`,
      tone: 'warn',
    });
  }

  if (input.transactionCount < 5) {
    items.push({
      title: 'Data is still forming',
      description: 'A few more transactions will make health signals and trend reads more reliable.',
      tone: 'info',
    });
  }

  if (!items.length) {
    items.push({
      title: 'Patterns look steady',
      description: 'Your current data does not show an urgent risk signal this month.',
      tone: 'ok',
    });
  }

  const severity: Record<FocusTone, number> = { critical: 0, warn: 1, info: 2, ok: 3 };
  return items.sort((left, right) => severity[left.tone] - severity[right.tone]);
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
  const { categories, fetchCategories } = useCategoryStore();
  const { progress: budgetProgress, fetchBudgetProgress } = useBudgetStore();
  const { transactions, hasLoaded: transactionsLoaded, fetchTransactions } = useTransactionStore();
  const { openTransactionForm, selectedMonth, setActivePage } = useUIStore();
  const [monthStory, setMonthStory] = useState('Summarizing your month...');
  const [storyLoading, setStoryLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!accountsLoaded) void fetchAccounts();
    if (!transactionsLoaded) void fetchTransactions();
    void fetchCategories();
  }, [accountsLoaded, fetchAccounts, fetchCategories, fetchTransactions, transactionsLoaded]);

  useEffect(() => {
    if (accountsLoaded) void fetchNetWorthTrend();
  }, [accountsLoaded, fetchNetWorthTrend]);

  const currentMonth = monthKey(selectedMonth.year, selectedMonth.month);

  useEffect(() => {
    void fetchBudgetProgress(currentMonth);
  }, [currentMonth, fetchBudgetProgress]);

  useEffect(() => {
    if (!transactionsLoaded) return;

    let active = true;
    setExpanded(false);

    const loadStory = async () => {
      setStoryLoading(true);
      try {
        const summary = await insightsRepository.getMonthStory(selectedMonth.year, selectedMonth.month);
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

    void loadStory();

    return () => {
      active = false;
    };
  }, [selectedMonth.month, selectedMonth.year, transactionsLoaded]);

  const monthTransactions = useMemo(
    () => transactions.filter((transaction) => transaction.date.startsWith(currentMonth)),
    [currentMonth, transactions],
  );
  const summary = useMemo(() => summarizeCashFlow(monthTransactions), [monthTransactions]);
  const totalPositiveBalances = useMemo(
    () => accounts.filter((account) => account.balance > 0).reduce((total, account) => total + account.balance, 0),
    [accounts],
  );
  const netWorth = useMemo(
    () => (accounts.length ? calculateNetWorth(accounts) : totalBalance),
    [accounts, totalBalance],
  );
  const trailingSpend = useMemo(
    () => calculateTrailingAverageMonthlySpend(transactions, 3, new Date(selectedMonth.year, selectedMonth.month - 1, 1)),
    [selectedMonth.month, selectedMonth.year, transactions],
  );
  const savingsRate = useMemo(
    () => calculateMonthlySavingsRate(summary.income, summary.expenses),
    [summary.expenses, summary.income],
  );
  const cashRunway = useMemo(
    () => calculateCashRunway(totalPositiveBalances, trailingSpend.average),
    [totalPositiveBalances, trailingSpend.average],
  );
  const concentration = useMemo(
    () => getSpendingConcentration(monthTransactions),
    [monthTransactions],
  );
  const health = useMemo(
    () => calculateHealthScore({
      savingsRate,
      cashRunwayMonths: cashRunway,
      spendingConcentrationShare: concentration.share,
      hasIncome: summary.income > 0,
      transactionCount: monthTransactions.length,
    }),
    [cashRunway, concentration.share, monthTransactions.length, savingsRate, summary.income],
  );
  const sankeyData = useMemo(
    () => buildSankeyData(monthTransactions, categories),
    [categories, monthTransactions],
  );
  const trendValues = useMemo(() => netWorthTrend.map((point) => point.value), [netWorthTrend]);
  const hasWeekTrend = useMemo(
    () => new Set(netWorthTrend.map((point) => point.date)).size >= 7,
    [netWorthTrend],
  );
  const hasMultiMonthTrend = useMemo(
    () => new Set(netWorthTrend.map((point) => point.date.slice(0, 7))).size > 1,
    [netWorthTrend],
  );
  const focus = useMemo(
    () =>
      buildFocusAreas({
        savingsRate,
        cashRunway,
        concentrationShare: concentration.share,
        concentrationCategory: concentration.categoryName,
        transactionCount: monthTransactions.length,
        hasIncome: summary.income > 0,
      }).slice(0, 3),
    [cashRunway, concentration.categoryName, concentration.share, monthTransactions.length, savingsRate, summary.income],
  );
  const savingsBarWidth = clamp(Math.max(savingsRate, 0), 0, 100);
  const runway = runwayBadge(cashRunway);
  const preview = firstSentence(monthStory);

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pb-4 pr-1">
      <motion.div variants={item} className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">{userName ? `Hello ${userName}` : 'Dashboard'}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-text-primary">Financial standing</h1>
          <p className="mt-1 text-sm text-text-secondary">A calm read on the month: what you kept, where it went, and what deserves attention.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setActivePage('insights')} className="text-xs">Open Insights</Button>
          <Button onClick={openTransactionForm} className="hidden text-xs sm:flex">Add Transaction</Button>
        </div>
      </motion.div>

      <div className="grid grid-cols-12 gap-3">
        <motion.div variants={item} className="col-span-12 md:col-span-4">
          <Card className="h-full rounded-xl p-5">
            <p className="text-[11px] uppercase tracking-[0.16em] text-text-secondary">Net Worth</p>
            <p className="numeric-display mt-3 text-3xl font-semibold text-accent">{formatCurrency(netWorth)}</p>
            <p className="mt-1 text-sm text-text-secondary">across {accounts.length} account{accounts.length === 1 ? '' : 's'}</p>
            {hasMultiMonthTrend && trendValues.length > 1 ? (
              <div className="mt-5"><Sparkline values={trendValues.slice(-45)} /></div>
            ) : (
              <p className="mt-5 text-xs text-text-tertiary">Add more history to unlock a longer net worth trend.</p>
            )}
          </Card>
        </motion.div>

        <motion.div variants={item} className="col-span-12 md:col-span-4">
          <Card className="h-full rounded-xl p-5">
            <p className="text-[11px] uppercase tracking-[0.16em] text-text-secondary">Monthly Net Flow</p>
            <p className={`numeric-display mt-3 text-3xl font-semibold ${summary.netFlow >= 0 ? 'text-income' : 'text-expense'}`}>{formatCurrency(summary.netFlow)}</p>
            <p className="mt-1 text-sm text-text-secondary">kept after expenses</p>
            <div className="mt-5 h-1 w-full overflow-hidden rounded-full bg-surface-muted">
              <div className="h-full rounded-full" style={{ width: `${savingsBarWidth}%`, background: 'linear-gradient(90deg, var(--color-income) 0%, var(--color-accent) 100%)' }} />
            </div>
            <span className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${savingsRate >= 0 ? 'bg-income-subtle text-income' : 'bg-expense-subtle text-expense'}`}>
              {savingsRate >= 0 ? `${savingsRate.toFixed(1)}% saved` : `${Math.abs(savingsRate).toFixed(1)}% overspent`}
            </span>
          </Card>
        </motion.div>

        <motion.div variants={item} className="col-span-12 md:col-span-4">
          <Card className="h-full rounded-xl p-5">
            <p className="text-[11px] uppercase tracking-[0.16em] text-text-secondary">Cash Runway</p>
            <p className="numeric-display mt-3 text-3xl font-semibold text-text-primary">{cashRunway == null ? 'N/A' : `${cashRunway.toFixed(1)} mo`}</p>
            <div className="mt-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${runway.className}`}>{runway.label}</span></div>
            <p className="mt-3 text-sm text-text-secondary">estimated months of expenses covered</p>
            {trailingSpend.monthCount > 0 && trailingSpend.monthCount < 3 && (
              <p className="mt-2 text-xs text-text-tertiary">Based on {trailingSpend.monthCount} month{trailingSpend.monthCount === 1 ? '' : 's'} of spending history.</p>
            )}
          </Card>
        </motion.div>
      </div>

      {budgetProgress.length > 0 && (
        <motion.div variants={item}>
          <button type="button" onClick={() => setActivePage('budgets')} className="w-full text-left">
            <Card className="rounded-xl p-4 transition-colors hover:bg-surface-muted">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-text-secondary">Budget Status</p>
                  <p className="mt-1 text-sm text-text-secondary">Quick read on every category envelope this month.</p>
                </div>
                <span className="inline-flex items-center gap-1 text-sm font-medium text-accent">Open budgets <ArrowRight size={14} /></span>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {budgetProgress.map((entry) => (
                  <div key={entry.budget.id} className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-text-primary">{entry.category.name}</span>
                      <span className={`text-xs font-semibold ${entry.percent_used > 100 ? 'text-expense' : entry.percent_used >= 75 ? 'text-warning' : 'text-income'}`}>
                        {entry.percent_used.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(entry.percent_used, 100)}%`, backgroundColor: entry.percent_used > 100 ? 'var(--color-expense)' : entry.percent_used >= 75 ? 'var(--color-warning)' : 'var(--color-income)' }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </button>
        </motion.div>
      )}

      <motion.div variants={item}>
        <Card className="rounded-xl p-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-5">
              <ProgressRing score={health.score} tone={health.tone} />
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-text-secondary">Financial Health Score</p>
                <p className="mt-2 text-3xl font-semibold text-text-primary">{health.band}</p>
                <p className="mt-2 max-w-xl text-sm text-text-secondary">Built from savings pace, cash runway, spending concentration, income coverage, and data depth.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 lg:max-w-[48%] lg:justify-end">
              {health.signals.map((signal) => (
                <button key={signal.key} type="button" onClick={() => setActivePage('insights')} className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${signal.tone === 'positive' ? 'bg-income-subtle text-income' : signal.tone === 'warning' ? 'bg-warning-subtle text-warning' : 'bg-expense-subtle text-expense'} hover:brightness-95`}>
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
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-text-secondary">Money Flow</p>
                <p className="mt-1 text-sm text-text-secondary">How this month's income moved into categories and savings.</p>
              </div>
              <SankeyCard sankeyData={sankeyData} />
            </Card>

            <Card className="rounded-xl p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent-subtle text-accent"><Sparkles size={18} /></span>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.16em] text-text-secondary">AI Summary</p>
                    <p className="text-sm text-text-secondary">A short monthly readout in plain language.</p>
                  </div>
                </div>
                <button type="button" onClick={() => setExpanded((current) => !current)} className="text-sm font-medium text-accent transition-colors hover:text-accent-hover">
                  {expanded ? 'Show less' : 'Read more'}
                </button>
              </div>
              <p className={`mt-4 text-sm leading-6 text-text-primary ${storyLoading ? 'animate-pulse' : ''}`}>{expanded ? monthStory : preview}</p>
            </Card>

            <Card className="rounded-xl p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-text-secondary">Net Worth Trend</p>
                  <p className="mt-1 text-sm text-text-secondary">Track your balance snapshots over time.</p>
                </div>
                <span className="text-xs text-text-tertiary">{netWorthTrend.length > 0 ? `${netWorthTrend.length} snapshots` : 'No history yet'}</span>
              </div>
              {hasWeekTrend ? (
                <div className="mt-6">
                  <div className="h-56 rounded-xl bg-surface-muted px-4 py-6"><Sparkline values={trendValues} /></div>
                  <div className="mt-4 flex items-center justify-between text-xs text-text-secondary">
                    <span>{formatDateShort(netWorthTrend[0].date)}</span>
                    <span>{formatDateShort(netWorthTrend[netWorthTrend.length - 1].date)}</span>
                  </div>
                </div>
              ) : (
                <div className="mt-6 rounded-xl bg-surface-muted px-5 py-8">
                  <Sparkline values={[2, 3, 3.5, 4, 4.2, 4.4, 4.8]} dashed />
                  <p className="mt-6 text-sm text-text-secondary">Track your net worth over time - check back after a week of use.</p>
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
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-info-subtle text-info"><Target size={18} /></span>
            </div>
            <div className="mt-5 space-y-3">
              {focus.map((entry) => (
                <div key={entry.title} className="rounded-xl border-l-[3px] px-4 py-3" style={entry.tone === 'critical' ? { backgroundColor: 'var(--color-expense-subtle)', borderLeftColor: 'var(--color-expense)' } : entry.tone === 'warn' ? { backgroundColor: '#FFFBF0', borderLeftColor: 'var(--color-warning)' } : entry.tone === 'ok' ? { backgroundColor: '#F0FAF5', borderLeftColor: 'var(--color-income)' } : { backgroundColor: '#F0F4FF', borderLeftColor: 'var(--color-info)' }}>
                  <p className="text-[13px] font-medium text-text-primary">{entry.title}</p>
                  <p className="mt-1 text-[12px] leading-5 text-text-secondary">{entry.description}</p>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setActivePage('insights')} className="mt-5 text-sm font-medium text-accent transition-colors hover:text-accent-hover">See full insights ?</button>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}
