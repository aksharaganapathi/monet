import React from 'react';
import { motion } from 'framer-motion';
import { Inbox } from 'lucide-react';
import monetLogo from '../../monet_logo.svg';

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
      className="relative flex flex-col items-center justify-center overflow-hidden rounded-2xl glass-elevated px-6 py-16 text-center"
    >
      <img
        src={monetLogo}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute h-36 w-auto grayscale opacity-[0.12]"
      />
      <div className="surface-muted relative z-10 mb-4 flex h-14 w-14 items-center justify-center rounded-xl text-text-secondary">
        {icon || <Inbox size={24} />}
      </div>
      <h3 className="relative z-10 text-lg font-semibold text-text-primary mb-1">{title}</h3>
      <p className="relative z-10 text-sm text-text-secondary max-w-sm mb-6">{description}</p>
      <div className="relative z-10">{action}</div>
    </motion.div>
  );
}
