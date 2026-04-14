import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, DollarSign, Search } from 'lucide-react';
import { useKeyboardShortcut } from '../hooks/useKeyboardShortcut';
import { getTodayISO } from '../lib/utils';
import { useAccountStore } from '../store/accountStore';
import { useCategoryStore } from '../store/categoryStore';
import { useTransactionStore } from '../store/transactionStore';
import { useUIStore } from '../store/uiStore';

export function CommandPalette() {
  const { isCommandPaletteOpen, toggleCommandPalette, closeTransactionForm } = useUIStore();
  const { accounts, fetchAccounts } = useAccountStore();
  const { categories } = useCategoryStore();
  const { addTransaction, fetchTransactions } = useTransactionStore();

  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useKeyboardShortcut('k', toggleCommandPalette, { ctrl: true });

  useEffect(() => {
    if (isCommandPaletteOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setInput('');
      setStatus('idle');
      setStatusMsg('');
    }
  }, [isCommandPaletteOpen]);

  const parseAndSubmit = async () => {
    const parts = input.trim().split(/\s+/);
    if (parts.length < 2) {
      setStatus('error');
      setStatusMsg('Format: <amount> <category> [account] [note]');
      return;
    }

    const amount = Number.parseFloat(parts[0]);
    if (Number.isNaN(amount)) {
      setStatus('error');
      setStatusMsg('Invalid amount');
      return;
    }

    const remainder = parts.slice(1);
    let category: (typeof categories)[number] | null = null;
    let categoryWordCount = 0;

    for (let count = remainder.length; count >= 1; count -= 1) {
      const candidate = remainder.slice(0, count).join(' ').toLowerCase();
      const found =
        categories.find((entry) => entry.name.toLowerCase() === candidate) ??
        categories.find((entry) => entry.name.toLowerCase().includes(candidate));

      if (found) {
        category = found;
        categoryWordCount = count;
        break;
      }
    }

    if (!category) {
      setStatus('error');
      setStatusMsg(`Category "${remainder[0]}" not found`);
      return;
    }

    const remainingAfterCategory = [...remainder.slice(categoryWordCount)];
    let account = accounts[0];

    if (remainingAfterCategory.length > 0) {
      const accountSearch = remainingAfterCategory[0].toLowerCase();
      const foundAccount = accounts.find((entry) => entry.name.toLowerCase().includes(accountSearch));
      if (foundAccount) {
        account = foundAccount;
        remainingAfterCategory.shift();
      }
    }

    if (!account) {
      setStatus('error');
      setStatusMsg('No accounts available');
      return;
    }

    const note =
      remainingAfterCategory.length > 0
        ? remainingAfterCategory.join(' ').replace(/"/g, '')
        : undefined;

    try {
      await addTransaction({
        amount,
        category_id: category.id,
        account_id: account.id,
        date: getTodayISO(),
        note,
      });
      await Promise.all([fetchTransactions(), fetchAccounts()]);
      setStatus('success');
      setStatusMsg(`Added ${amount >= 0 ? '+' : ''}$${Math.abs(amount).toFixed(2)} to ${category.name}`);
      setTimeout(() => {
        toggleCommandPalette();
        closeTransactionForm();
      }, 800);
    } catch (error) {
      setStatus('error');
      setStatusMsg((error as Error).message);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') parseAndSubmit();
    if (event.key === 'Escape') toggleCommandPalette();
  };

  return (
    <AnimatePresence>
      {isCommandPaletteOpen && (
        <motion.div
          ref={overlayRef}
          className="fixed inset-0 z-50 flex items-start justify-center bg-surface-overlay pt-[18vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(event) => {
            if (event.target === overlayRef.current) toggleCommandPalette();
          }}
        >
          <motion.div
            className="glass-elevated mx-4 w-full max-w-xl overflow-hidden rounded-2xl"
            initial={{ opacity: 0, scale: 0.96, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -10 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="flex items-center gap-3 border-b border-border-subtle bg-surface-muted px-5 py-4">
              <DollarSign size={18} className="shrink-0 text-accent" />
              <input
                ref={inputRef}
                value={input}
                onChange={(event) => {
                  setInput(event.target.value);
                  setStatus('idle');
                }}
                onKeyDown={handleKeyDown}
                placeholder="Quick add: -50 Food Checking lunch at cafe"
                className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
                aria-label="Quick transaction entry"
              />
              <kbd className="surface-card rounded-md px-2 py-0.5 text-xs text-text-tertiary">
                Enter
              </kbd>
            </div>

            <div className="bg-surface-elevated px-5 py-3 text-xs text-text-tertiary">
              {status === 'idle' && (
                <div className="flex items-center gap-2">
                  <Search size={12} />
                  <span>
                    Format: <code className="text-text-secondary">amount category [account] [note]</code> | Negative = expense
                  </span>
                </div>
              )}
              {status === 'success' && (
                <div className="flex items-center gap-2 text-income">
                  <ArrowRight size={12} />
                  <span>{statusMsg}</span>
                </div>
              )}
              {status === 'error' && (
                <div className="flex items-center gap-2 text-expense">
                  <span>Warning: {statusMsg}</span>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
