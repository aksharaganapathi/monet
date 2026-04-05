import { Landmark, CreditCard, Building2, Flag, Briefcase, Globe } from 'lucide-react';

interface BankIconProps {
  institution: string;
  size?: number;
  className?: string;
}

export function BankIcon({ institution, size = 16, className = "" }: BankIconProps) {
  switch (institution) {
    case 'chase':
      return <Landmark size={size} className={className} />;
    case 'bofa':
      return <Flag size={size} className={className} />;
    case 'wellsfargo':
      return <Briefcase size={size} className={className} />;
    case 'citi':
      return <Globe size={size} className={className} />;
    case 'capitalone':
    case 'usbank':
    case 'pnc':
    case 'truist':
      return <Building2 size={size} className={className} />;
    case 'discover':
    case 'amex':
      return <CreditCard size={size} className={className} />;
    default:
      return <Landmark size={size} className={className} />;
  }
}
