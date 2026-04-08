import { useState, useEffect } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Button } from '../../components/ui/Button';
import { useAccountStore } from '../../store/accountStore';
import type { Account } from '../../lib/types';

type AccountType = Account['type'];

interface AccountFormProps {
  isOpen: boolean;
  onClose: () => void;
  editingAccount: Account | null;
}

export function AccountForm({ isOpen, onClose, editingAccount }: AccountFormProps) {
  const { addAccount, updateAccount } = useAccountStore();
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('checking');
  const [institution, setInstitution] = useState<string>('other');
  const [balance, setBalance] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (editingAccount) {
      setName(editingAccount.name);
      setType(editingAccount.type);
      setInstitution(editingAccount.institution || 'other');
      setBalance('');
    } else {
      setName('');
      setType('checking');
      setInstitution('other');
      setBalance('');
    }
    setError('');
  }, [editingAccount, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Account name is required');
      return;
    }

    try {
      if (editingAccount) {
        await updateAccount({ id: editingAccount.id, name: name.trim(), type, institution });
      } else {
        const bal = parseFloat(balance) || 0;
        await addAccount({ name: name.trim(), type, balance: bal, institution });
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingAccount ? 'Edit Account' : 'Add Account'}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <Input
          label="Account Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Chase Checking"
          autoFocus
          error={error}
        />
        <Select
          label="Account Type"
          value={type}
          onChange={(e) => setType(e.target.value as AccountType)}
          options={[
            { value: 'checking', label: 'Checking' },
            { value: 'savings', label: 'Savings' },
            { value: 'investment', label: 'Investment' },
            { value: 'cash', label: 'Cash' },
          ]}
        />
        <Select
          label="Institution"
          value={institution}
          onChange={(e) => setInstitution(e.target.value)}
          options={[
            { value: 'chase', label: 'Chase' },
            { value: 'bofa', label: 'Bank of America' },
            { value: 'wellsfargo', label: 'Wells Fargo' },
            { value: 'citi', label: 'Citi' },
            { value: 'capitalone', label: 'Capital One' },
            { value: 'usbank', label: 'U.S. Bank' },
            { value: 'pnc', label: 'PNC' },
            { value: 'truist', label: 'Truist' },
            { value: 'discover', label: 'Discover' },
            { value: 'amex', label: 'American Express' },
            { value: 'other', label: 'Other/Generic' },
          ]}
        />
        {!editingAccount && (
          <Input
            label="Initial Balance"
            type="number"
            step="0.01"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            placeholder="0.00"
          />
        )}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">
            {editingAccount ? 'Save Changes' : 'Add Account'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
