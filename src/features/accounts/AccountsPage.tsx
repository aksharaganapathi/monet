import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Landmark, Pencil, Plus, Scale, Trash2, Wallet } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { BankIcon } from '../../components/ui/BankIcon';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { AccountForm } from './AccountForm';
import { useAccountStore } from '../../store/accountStore';
import { useTransactionStore } from '../../store/transactionStore';
import { formatCurrency } from '../../lib/utils';
import type { Account } from '../../lib/types';

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05 } },
};
const item = { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } };

export function AccountsPage() {
  const { accounts, totalBalance, hasLoaded, fetchAccounts, deleteAccount, setAccountBalance } = useAccountStore();
  const { fetchTransactions } = useTransactionStore();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [deletingAccount, setDeletingAccount] = useState<Account | null>(null);
  const [adjustingAccount, setAdjustingAccount] = useState<Account | null>(null);
  const [adjustedBalance, setAdjustedBalance] = useState('');
  const [adjustNote, setAdjustNote] = useState('Manual balance adjustment');
  const [adjustError, setAdjustError] = useState('');

  useEffect(() => {
    if (!hasLoaded) {
      fetchAccounts();
    }
  }, [hasLoaded, fetchAccounts]);

  const checkingTotal = useMemo(
    () => accounts.filter((account) => account.type === 'checking').reduce((sum, account) => sum + account.balance, 0),
    [accounts],
  );

  const savingsTotal = useMemo(
    () => accounts.filter((account) => account.type === 'savings').reduce((sum, account) => sum + account.balance, 0),
    [accounts],
  );

  const handleEdit = (account: Account) => {
    setEditingAccount(account);
    setIsFormOpen(true);
  };

  const requestAdjustBalance = (account: Account) => {
    setAdjustingAccount(account);
    setAdjustedBalance(account.balance.toFixed(2));
    setAdjustNote('Manual balance adjustment');
    setAdjustError('');
  };

  const closeAdjustBalance = () => {
    setAdjustingAccount(null);
    setAdjustedBalance('');
    setAdjustNote('Manual balance adjustment');
    setAdjustError('');
  };

  const handleAdjustBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustingAccount) return;

    const nextBalance = Number.parseFloat(adjustedBalance);
    if (Number.isNaN(nextBalance)) {
      setAdjustError('Please enter a valid balance.');
      return;
    }

    try {
      await setAccountBalance(adjustingAccount.id, nextBalance, adjustNote.trim() || undefined);
      await fetchTransactions(true);
      closeAdjustBalance();
    } catch (error) {
      setAdjustError((error as Error).message);
    }
  };

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      <motion.div variants={item} className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.03em] text-text-primary">Accounts</h1>
          <p className="mt-1 text-sm text-text-secondary">Your available cash and where it currently sits.</p>
        </div>
        <Button icon={<Plus size={16} />} onClick={() => setIsFormOpen(true)}>
          Add Account
        </Button>
      </motion.div>

      <div className="grid grid-cols-12 gap-4">
        <motion.div variants={item} className="col-span-12 lg:col-span-6">
          <Card className="rounded-[24px] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-secondary">Total Balance</p>
                <p className="mt-2 text-3xl font-semibold numeric-display text-text-primary">{formatCurrency(totalBalance)}</p>
                <p className="mt-2 text-xs text-text-secondary">{accounts.length} account{accounts.length !== 1 ? 's' : ''} connected</p>
              </div>
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-accent-subtle text-accent">
                <Wallet size={20} />
              </span>
            </div>
          </Card>
        </motion.div>

        <motion.div variants={item} className="col-span-12 sm:col-span-6 lg:col-span-3">
          <Card className="rounded-[24px] p-5">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white/65 text-accent">
                <Landmark size={18} />
              </span>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-secondary">Checking</p>
                <p className="mt-1 text-xl font-semibold numeric-display text-text-primary">{formatCurrency(checkingTotal)}</p>
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div variants={item} className="col-span-12 sm:col-span-6 lg:col-span-3">
          <Card className="rounded-[24px] p-5">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-income-subtle text-income">
                <Scale size={18} />
              </span>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-secondary">Savings</p>
                <p className="mt-1 text-xl font-semibold numeric-display text-text-primary">{formatCurrency(savingsTotal)}</p>
              </div>
            </div>
          </Card>
        </motion.div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {accounts.length === 0 ? (
          <motion.div variants={item} className="h-full">
            <EmptyState
              icon={<Wallet size={24} />}
              title="No accounts yet"
              description="Add your first account so Monet can track your real balance picture."
              action={
                <Button icon={<Plus size={16} />} onClick={() => setIsFormOpen(true)}>
                  Add Account
                </Button>
              }
            />
          </motion.div>
        ) : (
          <motion.div variants={item} className="grid h-full auto-rows-max content-start grid-cols-1 gap-4 overflow-auto pr-1 xl:grid-cols-2">
            {accounts.map((account) => (
              <Card key={account.id} className="rounded-[24px] p-5" hoverable>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${account.type === 'checking' ? 'bg-accent-subtle text-accent' : 'bg-income-subtle text-income'}`}>
                      <BankIcon institution={account.institution} size={22} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-text-primary">{account.name}</p>
                      <div className="mt-2 flex items-center gap-2">
                        <Badge variant={account.type === 'checking' ? 'accent' : 'income'}>{account.type}</Badge>
                        <span className="text-xs text-text-secondary capitalize">{account.institution}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleEdit(account)}
                      className="rounded-xl p-2 text-text-tertiary transition-colors hover:bg-accent-subtle hover:text-accent"
                      aria-label={`Edit ${account.name}`}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => setDeletingAccount(account)}
                      className="rounded-xl p-2 text-text-tertiary transition-colors hover:bg-expense-subtle hover:text-expense"
                      aria-label={`Delete ${account.name}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border border-white/55 bg-white/55 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-secondary">Current balance</p>
                  <p className={`mt-1 text-2xl font-semibold numeric-display ${account.balance >= 0 ? 'text-text-primary' : 'text-expense'}`}>
                    {formatCurrency(account.balance)}
                  </p>
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <p className="text-xs leading-5 text-text-secondary">If the bank balance differs from reality, adjust it and Monet will create the offset transaction.</p>
                  <Button size="sm" variant="secondary" onClick={() => requestAdjustBalance(account)}>
                    Adjust
                  </Button>
                </div>
              </Card>
            ))}
          </motion.div>
        )}
      </div>

      <AccountForm isOpen={isFormOpen} onClose={() => { setIsFormOpen(false); setEditingAccount(null); }} editingAccount={editingAccount} />

      <ConfirmDialog
        isOpen={Boolean(deletingAccount)}
        onClose={() => setDeletingAccount(null)}
        onConfirm={async () => {
          if (!deletingAccount) return;
          await deleteAccount(deletingAccount.id);
          setDeletingAccount(null);
        }}
        title="Delete Account"
        description={`Delete ${deletingAccount?.name ?? 'this account'} and all linked transactions? This cannot be undone.`}
        confirmLabel="Delete Account"
      />

      <Modal
        isOpen={Boolean(adjustingAccount)}
        onClose={closeAdjustBalance}
        title={adjustingAccount ? `Adjust Balance - ${adjustingAccount.name}` : 'Adjust Balance'}
        size="sm"
      >
        <form onSubmit={handleAdjustBalance} className="space-y-4">
          <p className="text-sm text-text-secondary">
            Set the exact account balance. Monet will automatically create an adjustment transaction so your history still reconciles.
          </p>

          <Input
            label="New Balance"
            type="number"
            step="0.01"
            value={adjustedBalance}
            onChange={(e) => setAdjustedBalance(e.target.value)}
            placeholder="0.00"
            autoFocus
            error={adjustError}
          />

          <Input label="Note" value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} placeholder="Manual balance adjustment" />

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={closeAdjustBalance}>
              Cancel
            </Button>
            <Button type="submit">Apply Balance</Button>
          </div>
        </form>
      </Modal>
    </motion.div>
  );
}
