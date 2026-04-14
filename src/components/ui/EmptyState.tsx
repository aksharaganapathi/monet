import React from 'react';
import { motion } from 'framer-motion';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative flex flex-col items-center justify-center overflow-hidden rounded-[28px] border border-border bg-white px-6 py-16 text-center"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_center,rgba(221,107,47,0.12),transparent_62%)]"
      />
      <div className="surface-muted relative z-10 mb-4 flex h-14 w-14 items-center justify-center rounded-2xl text-text-secondary">
        {icon || <Inbox size={24} />}
      </div>
      <h3 className="relative z-10 mb-1 text-lg font-semibold text-text-primary">{title}</h3>
      <p className="relative z-10 mb-6 max-w-sm text-sm text-text-secondary">{description}</p>
      <div className="relative z-10">{action}</div>
    </motion.div>
  );
}
