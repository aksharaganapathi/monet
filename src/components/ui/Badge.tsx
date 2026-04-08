import React from 'react';

type BadgeVariant = 'default' | 'income' | 'expense' | 'warning' | 'accent' | 'info';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-accent-subtle text-accent',
  income: 'bg-income-subtle text-income',
  expense: 'bg-expense-subtle text-expense',
  warning: 'bg-warning-subtle text-warning',
  accent: 'bg-accent-light text-accent',
  info: 'bg-info-subtle text-info',
};

export function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  return (
    <span
      className={`
        inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide
        ${variantClasses[variant]} ${className}
      `}
    >
      {children}
    </span>
  );
}
