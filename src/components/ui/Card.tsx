import React from 'react';
import { motion } from 'framer-motion';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  hoverable?: boolean;
  glass?: boolean;
}

export function Card({ children, className = '', onClick, hoverable = false, glass = false }: CardProps) {
  const base = glass
    ? 'rounded-xl p-4 glass-card'
    : 'rounded-xl p-4 glass-card';


  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={`${base} ${hoverable ? 'cursor-pointer transition-colors duration-200 hover:bg-surface-muted' : ''} ${className}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {children}
    </motion.div>
  );
}
