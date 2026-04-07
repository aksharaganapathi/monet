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
    ? 'rounded-lg p-4 glass-card'
    : 'rounded-lg p-4 glass-card';


  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={`${base} ${hoverable ? 'cursor-pointer transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[inset_1px_1px_0_rgba(255,255,255,0.62),inset_-1px_-1px_0_rgba(0,0,0,0.1),0_20px_34px_-24px_rgba(15,23,42,0.5)]' : ''} ${className}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {children}
    </motion.div>
  );
}
