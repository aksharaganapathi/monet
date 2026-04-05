import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', id, ...props }, ref) => {
    const inputId = id || label.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="space-y-1.5">
        <label htmlFor={inputId} className="block text-sm font-medium text-text-secondary">
          {label}
        </label>
        <input
          ref={ref}
          id={inputId}
          className={`
            w-full px-3.5 py-2.5 rounded-xl border text-sm font-medium
            bg-white/70 backdrop-blur-md text-text-primary
            border-border placeholder:text-text-tertiary
            focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent
            transition-all duration-150 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]
            ${error ? 'border-expense focus:ring-expense/30' : ''}
            ${className}
          `}
          {...props}
        />
        {error && <p className="text-xs text-expense mt-1">{error}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
