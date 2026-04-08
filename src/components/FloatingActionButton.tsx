import { Plus } from 'lucide-react';
import { motion } from 'framer-motion';
import { useUIStore } from '../store/uiStore';

export function FloatingActionButton() {
  const { openTransactionForm } = useUIStore();

  return (
    <motion.button
      onClick={openTransactionForm}
      className="fixed bottom-8 right-8 z-40 flex h-14 w-14 items-center justify-center rounded-xl border border-accent bg-accent text-white transition-all duration-200 hover:bg-accent-hover cursor-pointer"
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      aria-label="Add transaction"
      title="Add transaction (Ctrl+K)"
    >
      <Plus size={24} />
    </motion.button>
  );
}
