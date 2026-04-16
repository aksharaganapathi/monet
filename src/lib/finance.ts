interface AccountLike {
  balance: number;
}

interface CategoryLike {
  id: number;
  name: string;
}

interface TransactionLike {
  id: number;
  amount: number;
  date: string;
  note?: string | null;
  category_id?: number;
  category_name?: string;
}

interface CashFlowSummary {
  income: number;
  expenses: number;
  netFlow: number;
  transactionCount: number;
}

interface CategoryGroup {
  categoryId: number | null;
  categoryName: string;
  spent: number;
  income: number;
  total: number;
  count: number;
}

interface RecurringPattern {
  note: string;
  amount: number;
  category: string | null;
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  last_date: string;
  next_expected_date: string;
  transaction_ids: number[];
}

interface MonthForecast {
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

const FREQUENCY_WINDOWS = [
  { frequency: 'daily' as const, min: 1, max: 2, step: 1 },
  { frequency: 'weekly' as const, min: 5, max: 9, step: 7 },
  { frequency: 'monthly' as const, min: 28, max: 32, step: 30 },
  { frequency: 'yearly' as const, min: 360, max: 370, step: 365 },
];

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
