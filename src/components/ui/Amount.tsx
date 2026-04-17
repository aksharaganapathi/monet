import { useUIStore } from '../../store/uiStore';
import { formatCurrency } from '../../lib/utils';

interface AmountProps {
  value: number;
  mode?: 'currency' | 'percentage';
  className?: string;
  showSign?: boolean;
}

export function Amount({ value, mode = 'currency', className = '', showSign = false }: AmountProps) {
  const isPrivateMode = useUIStore((state) => state.isPrivateMode);

  if (isPrivateMode) {
    return <span className={className}>••••</span>;
  }

  if (mode === 'percentage') {
    const sign = showSign && value > 0 ? '+' : '';
    return <span className={className}>{sign}{value.toFixed(1)}%</span>;
  }

  const sign = showSign && value >= 0 ? '+' : showSign && value < 0 ? '-' : '';
  const displayValue = showSign ? Math.abs(value) : value;
  
  return (
    <span className={className}>
      {sign}{formatCurrency(displayValue)}
    </span>
  );
}
