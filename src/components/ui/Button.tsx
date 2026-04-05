import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  children?: React.ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-text-inverse shadow-[0_8px_20px_rgba(59,130,246,0.3)] hover:bg-accent-hover hover:-translate-y-0.5 active:scale-[0.98]',
  secondary: 'bg-white border border-border text-text-primary shadow-[0_4px_12px_rgba(15,23,42,0.06)] hover:bg-[#f8fafc] hover:-translate-y-0.5 active:scale-[0.98]',
  ghost: 'text-text-secondary hover:text-text-primary hover:bg-black/5 active:scale-[0.98]',
  danger: 'bg-expense text-text-inverse shadow-[0_8px_20px_rgba(244,63,94,0.3)] hover:bg-[#e11d48] hover:-translate-y-0.5 active:scale-[0.98]',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm gap-1.5',
  md: 'px-4 py-2 text-sm gap-2',
  lg: 'px-5 py-2.5 text-base gap-2',
};

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  children,
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      className={`
        inline-flex items-center justify-center font-semibold rounded-xl
        transition-all duration-200 cursor-pointer
        disabled:opacity-50 disabled:cursor-not-allowed
        disabled:shadow-none
        ${variantClasses[variant]}
        ${sizeClasses[size]}
        ${className}
      `}
      {...props}
    >
      {icon && <span className="flex-shrink-0">{icon}</span>}
      {children}
    </button>
  );
}
