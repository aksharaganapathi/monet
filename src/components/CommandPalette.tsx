import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, ArrowRight, DollarSign } from 'lucide-react';
import { useUIStore } from '../store/uiStore';
import { useAccountStore } from '../store/accountStore';
import { useCategoryStore } from '../store/categoryStore';
import { useTransactionStore } from '../store/transactionStore';
import { useKeyboardShortcut } from '../hooks/useKeyboardShortcut';
import { getTodayISO } from '../lib/utils';

export function CommandPalette() {
  const { isCommandPaletteOpen, toggleCommandPalette, closeTransactionForm } = useUIStore();
  const { accounts } = useAccountStore();
  const { categories } = useCategoryStore();
  const { addTransaction, fetchTransactions } = useTransactionStore();
  const { fetchAccounts } = useAccountStore();

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
    // Format: <amount> <category> [account] [note]
    // Example: -50 Food Checking "lunch at cafe"
    // Example: 5000 Salary Checking
    const parts = input.trim().split(/\s+/);
    if (parts.length < 2) {
      setStatus('error');
      setStatusMsg('Format: <amount> <category> [account] [note]');
      return;
    }

    const amount = parseFloat(parts[0]);
    if (isNaN(amount)) {
      setStatus('error');
      setStatusMsg('Invalid amount');
      return;
    }

    const categorySearch = parts[1].toLowerCase();
    const category = categories.find((c) => c.name.toLowerCase().includes(categorySearch));
    if (!category) {
      setStatus('error');
      setStatusMsg(`Category "${parts[1]}" not found`);
      return;
    }

    let account = accounts[0];
    if (parts.length >= 3) {
      const accountSearch = parts[2].toLowerCase();
      const found = accounts.find((a) => a.name.toLowerCase().includes(accountSearch));
      if (found) account = found;
    }

    if (!account) {
      setStatus('error');
      setStatusMsg('No accounts available');
      return;
    }

    const note = parts.length >= 4 ? parts.slice(3).join(' ').replace(/"/g, '') : undefined;

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
      setStatusMsg(`Added ${amount >= 0 ? '+' : ''}$${Math.abs(amount).toFixed(2)} → ${category.name}`);
      setTimeout(() => {
        toggleCommandPalette();
        closeTransactionForm();
      }, 800);
    } catch (e) {
      setStatus('error');
      setStatusMsg((e as Error).message);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') parseAndSubmit();
    if (e.key === 'Escape') toggleCommandPalette();
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
          onClick={(e) => {
            if (e.target === overlayRef.current) toggleCommandPalette();
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
              <DollarSign size={18} className="text-accent flex-shrink-0" />
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setStatus('idle');
                }}
                onKeyDown={handleKeyDown}
                placeholder="Quick add: -50 Food Checking lunch at cafe"
                className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
                aria-label="Quick transaction entry"
              />
              <kbd className="surface-card rounded-md px-2 py-0.5 text-xs text-text-tertiary">
                ↵
              </kbd>
            </div>

            <div className="bg-surface-elevated px-5 py-3 text-xs text-text-tertiary">
              {status === 'idle' && (
                <div className="flex items-center gap-2">
                  <Search size={12} />
                  <span>
                    Format: <code className="text-text-secondary">amount category [account] [note]</code> • Negative = expense
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
                  <span>⚠ {statusMsg}</span>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
