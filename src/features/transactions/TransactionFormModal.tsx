import { useState, useEffect } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Button } from '../../components/ui/Button';
import { useTransactionStore } from '../../store/transactionStore';
import { useAccountStore } from '../../store/accountStore';
import { useCategoryStore } from '../../store/categoryStore';
import { useUIStore } from '../../store/uiStore';
import { getTodayISO } from '../../lib/utils';

export function TransactionFormModal() {
  const { isTransactionFormOpen, closeTransactionForm } = useUIStore();
  const { addTransaction } = useTransactionStore();
  const { accounts } = useAccountStore();
  const { categories } = useCategoryStore();

  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(getTodayISO());
  const [note, setNote] = useState('');
  const [isExpense, setIsExpense] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isTransactionFormOpen) {
      setAmount('');
      setCategoryId(categories[0]?.id.toString() ?? '');
      setAccountId(accounts[0]?.id.toString() ?? '');
      setDate(getTodayISO());
      setNote('');
      setIsExpense(true);
      setError('');
    }
  }, [isTransactionFormOpen, accounts, categories]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount === 0) {
      setError('Please enter a valid amount');
      return;
    }
    if (!categoryId || !accountId) {
      setError('Please select a category and account');
      return;
    }

    try {
      await addTransaction({
        amount: isExpense ? -Math.abs(parsedAmount) : Math.abs(parsedAmount),
        category_id: parseInt(categoryId),
        account_id: parseInt(accountId),
        date,
        note: note.trim() || undefined,
      });
      closeTransactionForm();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal
      isOpen={isTransactionFormOpen}
      onClose={closeTransactionForm}
      title="Add Transaction"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Income / Expense Toggle */}
        <div className="flex gap-1 p-1 bg-surface rounded-xl border border-border-subtle">
          <button
            type="button"
            onClick={() => setIsExpense(true)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${
              isExpense ? 'bg-expense text-white' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            Expense
          </button>
          <button
            type="button"
            onClick={() => setIsExpense(false)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${
              !isExpense ? 'bg-income text-white' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            Income
          </button>
        </div>

        <Input
          label="Amount"
          type="number"
          step="0.01"
          min="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          autoFocus
          error={error}
        />

        <Select
          label="Category"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          placeholder="Select category"
        />

        <Select
          label="Account"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          options={accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.type})` }))}
          placeholder="Select account"
        />

        <Input
          label="Date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />

        <Input
          label="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g., lunch at café"
        />

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={closeTransactionForm}>
            Cancel
          </Button>
          <Button type="submit" className={isExpense ? '!bg-expense hover:!bg-expense/90' : '!bg-income hover:!bg-income/90'}>
            {isExpense ? 'Add Expense' : 'Add Income'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
