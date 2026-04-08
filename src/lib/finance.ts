export interface AccountLike {
  balance: number;
}

export interface CategoryLike {
  id: number;
  name: string;
}

export interface TransactionLike {
  id: number;
  amount: number;
  date: string;
  note?: string | null;
  category_id?: number;
  category_name?: string;
}

export interface CashFlowSummary {
  income: number;
  expenses: number;
  netFlow: number;
  transactionCount: number;
}

export interface CategoryGroup {
  categoryId: number | null;
  categoryName: string;
  spent: number;
  income: number;
  total: number;
  count: number;
}

export interface SpendingConcentration {
  categoryName: string | null;
  amount: number;
  share: number;
  level: 'low' | 'moderate' | 'high';
}

export interface HealthScoreInput {
  savingsRate: number;
  cashRunwayMonths: number | null;
  spendingConcentrationShare: number;
  hasIncome: boolean;
  transactionCount: number;
}

export interface HealthSignal {
  key: 'savings-rate' | 'runway' | 'concentration' | 'income' | 'data-quality';
  label: string;
  tone: 'positive' | 'warning' | 'negative';
}

export interface HealthScoreResult {
  score: number;
  band: 'Excellent' | 'Good' | 'Fair' | 'Needs attention';
  tone: 'positive' | 'gold' | 'warning' | 'negative';
  signals: HealthSignal[];
}

export interface SankeyNode {
  id: string;
  label: string;
  value: number;
  color: string;
  type: 'source' | 'expense' | 'savings' | 'deficit';
}

export interface SankeyLink {
  id: string;
  source: string;
  target: string;
  value: number;
  color: string;
  percentageOfIncome: number;
}

export interface SankeyData {
  state: 'ready' | 'empty';
  totalIncome: number;
  totalExpenses: number;
  netFlow: number;
  nodes: SankeyNode[];
  links: SankeyLink[];
  insight: string;
}

export interface RecurringPattern {
  note: string;
  amount: number;
  category: string | null;
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  last_date: string;
  next_expected_date: string;
  transaction_ids: number[];
}

export interface MonthForecast {
  active: boolean;
  confidenceLabel: 'Estimated' | 'Projected' | null;
  transactionCount: number;
  daysElapsed: number;
  daysRemaining: number;
  confirmedIncome: number;
  confirmedSpend: number;
  confirmedRecurring: number;
  projectedVariable: number;
  projectedTotalSpend: number;
  projectedNetFlow: number;
}

const DEFAULT_CATEGORY_COLOR = 'var(--color-sankey-other)';
const SANKEY_CATEGORY_COLOR_MAP: Record<string, string> = {
  savings: 'var(--color-sankey-savings)',
  deficit: 'var(--color-expense)',
  healthcare: 'var(--color-sankey-healthcare)',
  dining: 'var(--color-sankey-dining)',
  transport: 'var(--color-sankey-transport)',
  shopping: 'var(--color-sankey-shopping)',
  other: 'var(--color-sankey-other)',
};

const FREQUENCY_WINDOWS = [
  { frequency: 'daily' as const, min: 1, max: 2, step: 1 },
  { frequency: 'weekly' as const, min: 5, max: 9, step: 7 },
  { frequency: 'monthly' as const, min: 28, max: 32, step: 30 },
  { frequency: 'yearly' as const, min: 360, max: 370, step: 365 },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toLocalDate(date: string | Date): Date {
  if (date instanceof Date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: string | Date, days: number): string {
  const next = toLocalDate(date);
  next.setDate(next.getDate() + days);
  return toIsoDate(next);
}

function addMonths(date: string | Date, months: number): string {
  const next = toLocalDate(date);
  next.setMonth(next.getMonth() + months);
  return toIsoDate(next);
}

function addYears(date: string | Date, years: number): string {
  const next = toLocalDate(date);
  next.setFullYear(next.getFullYear() + years);
  return toIsoDate(next);
}

function differenceInDays(left: string, right: string): number {
  const leftDate = toLocalDate(left);
  const rightDate = toLocalDate(right);
  return Math.round((rightDate.getTime() - leftDate.getTime()) / 86_400_000);
}

function getMonthKey(date: string | Date): string {
  const value = toLocalDate(date);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
}

function startOfMonth(date: string | Date): Date {
  const value = toLocalDate(date);
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function endOfMonth(date: string | Date): Date {
  const value = toLocalDate(date);
  return new Date(value.getFullYear(), value.getMonth() + 1, 0);
}

function getCategoryName(transaction: TransactionLike, categories: CategoryLike[] = []): string {
  if (transaction.category_name?.trim()) {
    return transaction.category_name.trim();
  }

  if (transaction.category_id != null) {
    const match = categories.find((category) => category.id === transaction.category_id);
    if (match) {
      return match.name;
    }
  }

  return 'Other';
}

function normaliseCategoryKey(name: string): string {
  return name.trim().toLowerCase();
}

function getSankeyColor(categoryName: string): string {
  const normalized = normaliseCategoryKey(categoryName);
  return SANKEY_CATEGORY_COLOR_MAP[normalized] ?? DEFAULT_CATEGORY_COLOR;
}

function isWithinAmountTolerance(values: number[]): boolean {
  if (values.length < 2) {
    return false;
  }

  const baseline = Math.abs(values[0]);
  const tolerance = Math.max(baseline * 0.01, 0.01);
  return values.every((value) => Math.abs(Math.abs(value) - baseline) <= tolerance);
}

function detectFrequency(intervals: number[]): { frequency: RecurringPattern['frequency']; step: number } | null {
  for (const window of FREQUENCY_WINDOWS) {
    if (intervals.every((interval) => interval >= window.min && interval <= window.max)) {
      return { frequency: window.frequency, step: window.step };
    }
  }

  return null;
}

function nextDateForFrequency(date: string, frequency: RecurringPattern['frequency']): string {
  if (frequency === 'daily') {
    return addDays(date, 1);
  }
  if (frequency === 'weekly') {
    return addDays(date, 7);
  }
  if (frequency === 'monthly') {
    return addMonths(date, 1);
  }
  return addYears(date, 1);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function getMonthBoundaries(currentDate: Date) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  return { monthStart, monthEnd };
}

function getMonthlyExpenseTotals(transactions: TransactionLike[]): Map<string, number> {
  const totals = new Map<string, number>();

  for (const transaction of transactions) {
    if (transaction.amount >= 0) {
      continue;
    }

    const monthKey = getMonthKey(transaction.date);
    totals.set(monthKey, (totals.get(monthKey) ?? 0) + Math.abs(transaction.amount));
  }

  return totals;
}

export function summarizeCashFlow(transactions: TransactionLike[]): CashFlowSummary {
  const income = sum(transactions.filter((transaction) => transaction.amount > 0).map((transaction) => transaction.amount));
  const expenses = sum(transactions.filter((transaction) => transaction.amount < 0).map((transaction) => Math.abs(transaction.amount)));

  return {
    income,
    expenses,
    netFlow: income - expenses,
    transactionCount: transactions.length,
  };
}

export function calculateNetWorth(accounts: AccountLike[]): number {
  return sum(accounts.map((account) => account.balance));
}

export function calculateMonthlySavingsRate(income: number, expenses: number): number {
  if (income <= 0) {
    return 0;
  }

  return ((income - expenses) / income) * 100;
}

export function calculateCashRunway(totalBalance: number, monthlyExpenses: number): number | null {
  if (monthlyExpenses <= 0) {
    return null;
  }

  return Math.max(totalBalance, 0) / monthlyExpenses;
}

export function groupTransactionsByCategory(
  transactions: TransactionLike[],
  categories: CategoryLike[] = [],
): CategoryGroup[] {
  const groups = new Map<string, CategoryGroup>();

  for (const transaction of transactions) {
    const categoryName = getCategoryName(transaction, categories);
    const categoryKey = normaliseCategoryKey(categoryName);
    const existing = groups.get(categoryKey) ?? {
      categoryId: transaction.category_id ?? null,
      categoryName,
      spent: 0,
      income: 0,
      total: 0,
      count: 0,
    };

    if (transaction.amount < 0) {
      existing.spent += Math.abs(transaction.amount);
    } else {
      existing.income += transaction.amount;
    }

    existing.total += Math.abs(transaction.amount);
    existing.count += 1;
    groups.set(categoryKey, existing);
  }

  return [...groups.values()].sort((left, right) => right.spent - left.spent || right.total - left.total);
}

export function getSpendingConcentration(
  transactions: TransactionLike[],
  categories: CategoryLike[] = [],
): SpendingConcentration {
  const expenseGroups = groupTransactionsByCategory(
    transactions.filter((transaction) => transaction.amount < 0),
    categories,
  );

  const totalExpenses = sum(expenseGroups.map((group) => group.spent));
  const topGroup = expenseGroups[0];

  if (!topGroup || totalExpenses <= 0) {
    return {
      categoryName: null,
      amount: 0,
      share: 0,
      level: 'low',
    };
  }

  const share = (topGroup.spent / totalExpenses) * 100;

  return {
    categoryName: topGroup.categoryName,
    amount: topGroup.spent,
    share,
    level: share > 50 ? 'high' : share >= 40 ? 'moderate' : 'low',
  };
}

export function calculateHealthScore(input: HealthScoreInput): HealthScoreResult {
  let score = 100;

  if (input.savingsRate < 10) {
    score -= 25;
  } else if (input.savingsRate < 20) {
    score -= 10;
  } else if (input.savingsRate >= 35) {
    score += 5;
  }

  if (input.cashRunwayMonths != null) {
    if (input.cashRunwayMonths < 1) {
      score -= 30;
    } else if (input.cashRunwayMonths < 3) {
      score -= 15;
    }
  }

  if (input.spendingConcentrationShare > 50) {
    score -= 20;
  } else if (input.spendingConcentrationShare >= 40) {
    score -= 10;
  }

  if (!input.hasIncome) {
    score -= 15;
  }

  if (input.transactionCount < 5) {
    score -= 10;
  }

  const finalScore = clamp(Math.round(score), 0, 100);

  const band =
    finalScore >= 80
      ? 'Excellent'
      : finalScore >= 60
        ? 'Good'
        : finalScore >= 40
          ? 'Fair'
          : 'Needs attention';

  const tone =
    band === 'Excellent'
      ? 'positive'
      : band === 'Good'
        ? 'gold'
        : band === 'Fair'
          ? 'warning'
          : 'negative';

  const signals: HealthSignal[] = [
    {
      key: 'savings-rate',
      label:
        input.savingsRate >= 20
          ? 'Savings rate ✓'
          : input.savingsRate >= 10
            ? 'Savings rate steady'
            : 'Savings rate low',
      tone: input.savingsRate >= 20 ? 'positive' : input.savingsRate >= 10 ? 'warning' : 'negative',
    },
    {
      key: 'runway',
      label:
        input.cashRunwayMonths == null
          ? 'Liquidity forming'
          : input.cashRunwayMonths >= 3
            ? 'Liquidity healthy'
            : input.cashRunwayMonths >= 1
              ? 'Liquidity limited'
              : 'Liquidity low',
      tone:
        input.cashRunwayMonths == null
          ? 'warning'
          : input.cashRunwayMonths >= 3
            ? 'positive'
            : input.cashRunwayMonths >= 1
              ? 'warning'
              : 'negative',
    },
    {
      key: 'concentration',
      label:
        input.spendingConcentrationShare > 50
          ? 'Concentration risk'
          : input.spendingConcentrationShare >= 40
            ? 'Concentration watch'
            : 'Spend mix balanced',
      tone:
        input.spendingConcentrationShare > 50
          ? 'negative'
          : input.spendingConcentrationShare >= 40
            ? 'warning'
            : 'positive',
    },
    {
      key: 'income',
      label: input.hasIncome ? 'Income recorded' : 'No income this month',
      tone: input.hasIncome ? 'positive' : 'negative',
    },
    {
      key: 'data-quality',
      label: input.transactionCount >= 5 ? 'Data depth okay' : 'More data needed',
      tone: input.transactionCount >= 5 ? 'positive' : 'warning',
    },
  ];

  return {
    score: finalScore,
    band,
    tone,
    signals,
  };
}

export function buildSankeyData(
  transactions: TransactionLike[],
  categories: CategoryLike[] = [],
): SankeyData {
  const summary = summarizeCashFlow(transactions);

  if (transactions.length <= 1 || summary.expenses <= 0 || summary.income <= 0) {
    return {
      state: 'empty',
      totalIncome: summary.income,
      totalExpenses: summary.expenses,
      netFlow: summary.netFlow,
      nodes: [],
      links: [],
      insight: 'Add more transactions to see your money flow.',
    };
  }

  const expenseGroups = groupTransactionsByCategory(
    transactions.filter((transaction) => transaction.amount < 0),
    categories,
  ).filter((group) => group.spent > 0);

  const savingsValue = summary.netFlow >= 0 ? summary.netFlow : Math.abs(summary.netFlow);
  const savingsLabel = summary.netFlow >= 0 ? 'Savings' : 'Deficit';
  const savingsType = summary.netFlow >= 0 ? 'savings' : 'deficit';
  const savingsColor = summary.netFlow >= 0 ? getSankeyColor('savings') : getSankeyColor('deficit');

  const nodes: SankeyNode[] = [
    {
      id: 'income',
      label: 'Income',
      value: summary.income,
      color: 'var(--color-accent)',
      type: 'source',
    },
    ...expenseGroups.map((group) => ({
      id: `category-${normaliseCategoryKey(group.categoryName)}`,
      label: group.categoryName,
      value: group.spent,
      color: getSankeyColor(group.categoryName),
      type: 'expense' as const,
    })),
  ];

  if (savingsValue > 0) {
    nodes.push({
      id: savingsType,
      label: savingsLabel,
      value: savingsValue,
      color: savingsColor,
      type: savingsType,
    });
  }

  const links: SankeyLink[] = [
    ...expenseGroups.map((group) => ({
      id: `income-${normaliseCategoryKey(group.categoryName)}`,
      source: 'income',
      target: `category-${normaliseCategoryKey(group.categoryName)}`,
      value: group.spent,
      color: getSankeyColor(group.categoryName),
      percentageOfIncome: summary.income > 0 ? (group.spent / summary.income) * 100 : 0,
    })),
  ];

  if (savingsValue > 0) {
    links.push({
      id: `income-${savingsType}`,
      source: 'income',
      target: savingsType,
      value: savingsValue,
      color: savingsColor,
      percentageOfIncome: summary.income > 0 ? (savingsValue / summary.income) * 100 : 0,
    });
  }

  const concentration = getSpendingConcentration(transactions, categories);
  const savingsRate = calculateMonthlySavingsRate(summary.income, summary.expenses);

  const insight =
    concentration.share > 50 && concentration.categoryName
      ? `${Math.round(concentration.share)}% of your income went to ${concentration.categoryName} this month. That's a concentration risk.`
      : summary.netFlow > 0
        ? `You kept ${savingsRate.toFixed(1)}% of your income. That's a strong savings pace.`
        : `Spending ran ${Math.abs(summary.netFlow).toFixed(2)} beyond income this month. Watch for a deficit pattern.`;

  return {
    state: 'ready',
    totalIncome: summary.income,
    totalExpenses: summary.expenses,
    netFlow: summary.netFlow,
    nodes,
    links,
    insight,
  };
}

export function detectRecurring(transactions: TransactionLike[]): RecurringPattern[] {
  const groups = new Map<string, TransactionLike[]>();

  for (const transaction of transactions) {
    const key = transaction.note?.trim().toLowerCase();
    if (!key) {
      continue;
    }

    const existing = groups.get(key) ?? [];
    existing.push(transaction);
    groups.set(key, existing);
  }

  const patterns: RecurringPattern[] = [];

  for (const [noteKey, groupedTransactions] of groups) {
    if (groupedTransactions.length < 2) {
      continue;
    }

    const ordered = [...groupedTransactions].sort((left, right) => left.date.localeCompare(right.date));
    const amounts = ordered.map((transaction) => transaction.amount);

    if (!isWithinAmountTolerance(amounts)) {
      continue;
    }

    const intervals = ordered.slice(1).map((transaction, index) => differenceInDays(ordered[index].date, transaction.date));
    const frequency = detectFrequency(intervals);

    if (!frequency) {
      continue;
    }

    const lastTransaction = ordered[ordered.length - 1];
    patterns.push({
      note: lastTransaction.note?.trim() || noteKey,
      amount: sum(amounts) / amounts.length,
      category: lastTransaction.category_name ?? null,
      frequency: frequency.frequency,
      last_date: lastTransaction.date,
      next_expected_date: nextDateForFrequency(lastTransaction.date, frequency.frequency),
      transaction_ids: ordered.map((transaction) => transaction.id),
    });
  }

  return patterns.sort((left, right) => Math.abs(right.amount) - Math.abs(left.amount));
}

export function forecastMonthEnd(
  transactions: TransactionLike[],
  recurringPatterns: RecurringPattern[],
  currentDate: Date,
): MonthForecast {
  const { monthStart, monthEnd } = getMonthBoundaries(currentDate);
  const monthKey = getMonthKey(currentDate);
  const daysElapsed = currentDate.getDate();
  const daysInMonth = monthEnd.getDate();
  const daysRemaining = Math.max(daysInMonth - daysElapsed, 0);
  const monthTransactions = transactions.filter((transaction) => getMonthKey(transaction.date) === monthKey);

  if (monthTransactions.length < 10 || daysElapsed < 14) {
    return {
      active: false,
      confidenceLabel: null,
      transactionCount: monthTransactions.length,
      daysElapsed,
      daysRemaining,
      confirmedIncome: 0,
      confirmedSpend: 0,
      confirmedRecurring: 0,
      projectedVariable: 0,
      projectedTotalSpend: 0,
      projectedNetFlow: 0,
    };
  }

  const recurringTransactionIds = new Set(
    recurringPatterns.flatMap((pattern) => pattern.transaction_ids),
  );

  const confirmedIncome = sum(
    monthTransactions.filter((transaction) => transaction.amount > 0).map((transaction) => transaction.amount),
  );

  const confirmedSpend = sum(
    monthTransactions.filter((transaction) => transaction.amount < 0).map((transaction) => Math.abs(transaction.amount)),
  );

  const recurringSpentSoFar = sum(
    monthTransactions
      .filter((transaction) => transaction.amount < 0 && recurringTransactionIds.has(transaction.id))
      .map((transaction) => Math.abs(transaction.amount)),
  );

  const variableSpentSoFar = sum(
    monthTransactions
      .filter((transaction) => transaction.amount < 0 && !recurringTransactionIds.has(transaction.id))
      .map((transaction) => Math.abs(transaction.amount)),
  );

  const projectedRecurringRemaining = sum(
    recurringPatterns
      .filter((pattern) => pattern.amount < 0)
      .flatMap((pattern) => {
        const expectedDates: string[] = [];
        let nextDate = pattern.next_expected_date;
        while (toLocalDate(nextDate) <= monthEnd) {
          if (toLocalDate(nextDate) > currentDate && toLocalDate(nextDate) >= monthStart) {
            expectedDates.push(nextDate);
          }

          nextDate = nextDateForFrequency(nextDate, pattern.frequency);
        }
        return expectedDates.map(() => Math.abs(pattern.amount));
      }),
  );

  const projectedVariableRemaining = daysElapsed > 0 ? (variableSpentSoFar / daysElapsed) * daysRemaining : 0;
  const confirmedRecurring = recurringSpentSoFar + projectedRecurringRemaining;
  const projectedVariable = variableSpentSoFar + projectedVariableRemaining;
  const projectedTotalSpend = confirmedRecurring + projectedVariable;
  const projectedNetFlow = confirmedIncome - projectedTotalSpend;

  return {
    active: true,
    confidenceLabel: monthTransactions.length >= 20 ? 'Projected' : 'Estimated',
    transactionCount: monthTransactions.length,
    daysElapsed,
    daysRemaining,
    confirmedIncome,
    confirmedSpend,
    confirmedRecurring,
    projectedVariable,
    projectedTotalSpend,
    projectedNetFlow,
  };
}

export function calculateTrailingAverageMonthlySpend(
  transactions: TransactionLike[],
  monthsToInclude = 3,
  currentDate: Date = new Date(),
): { average: number; monthCount: number } {
  const monthlyTotals = getMonthlyExpenseTotals(transactions);
  const totals: number[] = [];

  for (let offset = 0; offset < monthsToInclude; offset += 1) {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - offset, 1);
    const total = monthlyTotals.get(getMonthKey(date));
    if (total != null && total > 0) {
      totals.push(total);
    }
  }

  if (totals.length === 0) {
    return { average: 0, monthCount: 0 };
  }

  return {
    average: sum(totals) / totals.length,
    monthCount: totals.length,
  };
}
