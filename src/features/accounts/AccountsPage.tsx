import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Wallet, Pencil, Trash2 } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { BankIcon } from '../../components/ui/BankIcon';
import { AccountForm } from './AccountForm';
import { useAccountStore } from '../../store/accountStore';
import { formatCurrency } from '../../lib/utils';
import type { Account } from '../../lib/types';

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05 } },
};
const item = { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } };

export function AccountsPage() {
  const { accounts, totalBalance, fetchAccounts, deleteAccount } = useAccountStore();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);

  useEffect(() => {
    fetchAccounts();
  }, []);

  const handleEdit = (account: Account) => {
    setEditingAccount(account);
    setIsFormOpen(true);
  };

  const handleDelete = async (id: number) => {
    if (confirm('Delete this account and all its transactions?')) {
      await deleteAccount(id);
    }
  };

  const handleCloseForm = () => {
    setIsFormOpen(false);
    setEditingAccount(null);
  };

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-8">
      {/* Header */}
      <motion.div variants={item} className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Accounts</h1>
          <p className="text-sm text-text-secondary mt-1">
            Manage your bank accounts
          </p>
        </div>
        <Button icon={<Plus size={16} />} onClick={() => setIsFormOpen(true)}>
          Add Account
        </Button>
      </motion.div>

      {/* Total Balance Card */}
      <motion.div variants={item}>
        <Card className="bg-gradient-to-br from-accent to-accent-hover !border-0 text-white">
          <p className="text-sm font-medium text-white/80">Total Balance</p>
          <p className="text-3xl font-bold mt-1">{formatCurrency(totalBalance)}</p>
          <p className="text-xs text-white/60 mt-2">
            {accounts.length} account{accounts.length !== 1 ? 's' : ''}
          </p>
        </Card>
      </motion.div>

      {/* Account List */}
      {accounts.length === 0 ? (
        <motion.div variants={item}>
          <EmptyState
            icon={<Wallet size={24} />}
            title="No accounts yet"
            description="Add your first bank account to start tracking your finances."
            action={
              <Button icon={<Plus size={16} />} onClick={() => setIsFormOpen(true)}>
                Add Account
              </Button>
            }
          />
        </motion.div>
      ) : (
        <motion.div variants={item} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {accounts.map((account) => (
            <Card key={account.id} className="group" hoverable>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${
                    account.type === 'checking' ? 'bg-accent-subtle' : 'bg-income-subtle'
                  }`}>
                    <BankIcon institution={account.institution} size={20} className={account.type === 'checking' ? 'text-accent' : 'text-income'} />
                  </div>
                  <div>
                    <p className="text-base font-semibold text-text-primary">{account.name}</p>
                    <Badge variant={account.type === 'checking' ? 'accent' : 'income'}>
                      {account.type}
                    </Badge>
                  </div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleEdit(account)}
                    className="p-1.5 rounded-lg text-text-tertiary hover:text-accent hover:bg-accent-subtle transition-colors cursor-pointer"
                    aria-label={`Edit ${account.name}`}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(account.id)}
                    className="p-1.5 rounded-lg text-text-tertiary hover:text-expense hover:bg-expense-subtle transition-colors cursor-pointer"
                    aria-label={`Delete ${account.name}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-border-subtle">
                <p className="text-xs text-text-tertiary">Current Balance</p>
                <p className={`text-xl font-bold mt-0.5 ${account.balance >= 0 ? 'text-text-primary' : 'text-expense'}`}>
                  {formatCurrency(account.balance)}
                </p>
              </div>
            </Card>
          ))}
        </motion.div>
      )}

      {/* Account Form Modal */}
      <AccountForm
        isOpen={isFormOpen}
        onClose={handleCloseForm}
        editingAccount={editingAccount}
      />
    </motion.div>
  );
}
