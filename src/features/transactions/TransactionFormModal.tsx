import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Button } from '../../components/ui/Button';
import { useTransactionStore } from '../../store/transactionStore';
import { useAccountStore } from '../../store/accountStore';
import { useCategoryStore } from '../../store/categoryStore';
import { useUIStore } from '../../store/uiStore';
import { getTodayISO } from '../../lib/utils';
import { splitCategoriesByType } from '../../lib/categories';

export function TransactionFormModal() {
  const amountRef = useRef<HTMLInputElement>(null);
  const { isTransactionFormOpen, editingTransactionId, closeTransactionForm } = useUIStore();
  const { transactions, addTransaction, updateTransaction } = useTransactionStore();
  const { accounts } = useAccountStore();
  const { categories } = useCategoryStore();

  const editingTransaction = transactions.find((txn) => txn.id === editingTransactionId) ?? null;

  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(getTodayISO());
  const [note, setNote] = useState('');
  const [isExpense, setIsExpense] = useState(true);
  const [categorySearch, setCategorySearch] = useState('');
  const [error, setError] = useState('');

  const { incomeCategories, expenseCategories } = useMemo(
    () => splitCategoriesByType(categories),
    [categories],
  );

  const visibleCategories = useMemo(() => {
    const source = isExpense ? expenseCategories : incomeCategories;
    const search = categorySearch.trim().toLowerCase();
    if (!search) {
      return source;
    }
    return source.filter((category) => category.name.toLowerCase().includes(search));
  }, [categorySearch, expenseCategories, incomeCategories, isExpense]);

  useEffect(() => {
    if (!isTransactionFormOpen) {
      return;
    }

    if (editingTransaction) {
      setAmount(Math.abs(editingTransaction.amount).toString());
      setCategoryId(editingTransaction.category_id.toString());
      setAccountId(editingTransaction.account_id.toString());
      setDate(editingTransaction.date);
      setNote(editingTransaction.note ?? '');
      setIsExpense(editingTransaction.amount < 0);
      setCategorySearch(editingTransaction.category_name);
    } else {
      const defaultCategories = expenseCategories;
      setAmount('');
      setCategoryId(defaultCategories[0]?.id.toString() ?? '');
      setAccountId(accounts[0]?.id.toString() ?? '');
      setDate(getTodayISO());
      setNote('');
      setIsExpense(true);
      setCategorySearch('');
    }

    setError('');
    queueMicrotask(() => amountRef.current?.focus());
  }, [accounts, editingTransaction, expenseCategories, isTransactionFormOpen]);

  useEffect(() => {
    if (!isTransactionFormOpen) {
      return;
    }

    const pool = isExpense ? expenseCategories : incomeCategories;
    if (!pool.some((category) => category.id.toString() === categoryId)) {
      setCategoryId(pool[0]?.id.toString() ?? '');
    }
  }, [categoryId, expenseCategories, incomeCategories, isExpense, isTransactionFormOpen]);

  const handleSubmit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const parsedAmount = Number.parseFloat(amount);
    if (Number.isNaN(parsedAmount) || parsedAmount === 0) {
      setError('Please enter a valid amount.');
      return;
    }
    if (!categoryId || !accountId) {
      setError('Please select a category and account.');
      return;
    }

    try {
      const normalizedAmount = isExpense ? -Math.abs(parsedAmount) : Math.abs(parsedAmount);

      if (editingTransaction) {
        await updateTransaction({
          id: editingTransaction.id,
          amount: normalizedAmount,
          category_id: Number.parseInt(categoryId, 10),
          account_id: Number.parseInt(accountId, 10),
          date,
          note: note.trim() || undefined,
        });
      } else {
        await addTransaction({
          amount: normalizedAmount,
          category_id: Number.parseInt(categoryId, 10),
          account_id: Number.parseInt(accountId, 10),
          date,
          note: note.trim() || undefined,
        });
      }
      closeTransactionForm();
    } catch (submitError) {
      setError((submitError as Error).message);
    }
  };

  const handleFormKeyDown = (event: React.KeyboardEvent<HTMLFormElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <Modal
      isOpen={isTransactionFormOpen}
      onClose={closeTransactionForm}
      title={editingTransaction ? 'Edit Transaction' : 'Add Transaction'}
    >
      <form onSubmit={handleSubmit} onKeyDown={handleFormKeyDown} className="space-y-5">
        <div className="surface-card flex gap-1 rounded-xl p-1">
          <button
            type="button"
            onClick={() => setIsExpense(true)}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${isExpense ? 'bg-expense text-white' : 'text-text-secondary hover:bg-expense-subtle hover:text-text-primary'}`}
          >
            Expense
          </button>
          <button
            type="button"
            onClick={() => setIsExpense(false)}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${!isExpense ? 'bg-income text-white' : 'text-text-secondary hover:bg-income-subtle hover:text-text-primary'}`}
          >
            Income
          </button>
        </div>

        <Input
          label="Date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />

        <Input
          ref={amountRef}
          label="Amount"
          type="number"
          step="0.01"
          min="0.01"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="0.00"
          error={error}
        />

        <Input
          label="Search categories"
          value={categorySearch}
          onChange={(event) => setCategorySearch(event.target.value)}
          placeholder={isExpense ? 'Search expense categories' : 'Search income categories'}
        />

        <Select
          label="Category"
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
          options={visibleCategories.map((category) => ({ value: category.id, label: category.name }))}
          placeholder="Select category"
        />

        <Select
          label="Account"
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
          options={accounts.map((account) => ({ value: account.id, label: `${account.name} (${account.type})` }))}
          placeholder="Select account"
        />

        <Input
          label="Note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Optional note"
        />

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={closeTransactionForm}>
            Cancel
          </Button>
          <Button type="submit">
            {editingTransaction ? 'Save Changes' : isExpense ? 'Add Expense' : 'Add Income'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
