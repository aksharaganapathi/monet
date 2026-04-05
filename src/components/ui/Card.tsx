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
    ? 'bg-white/90 rounded-lg p-4 border border-border'
    : 'bg-white rounded-lg p-4 border border-border';


  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={`${base} ${hoverable ? 'cursor-pointer transition-all duration-200 hover:-translate-y-[1px] hover:shadow-elevated' : ''} ${className}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {children}
    </motion.div>
  );
}
