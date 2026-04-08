import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function BaseIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export function DashboardIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="2" y="2" width="4.5" height="4.5" rx="0.8" />
      <rect x="9.5" y="2" width="4.5" height="4.5" rx="0.8" />
      <rect x="2" y="9.5" width="4.5" height="4.5" rx="0.8" />
      <rect x="9.5" y="9.5" width="4.5" height="4.5" rx="0.8" />
    </BaseIcon>
  );
}

export function InsightsIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M2 12.5h12" />
      <path d="M3.5 10.5 6.5 7.5l2.2 2.2L12.5 4.8" />
      <path d="m10.7 4.8 1.8.1-.1 1.8" />
    </BaseIcon>
  );
}

export function AccountsIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="1.5" y="3" width="13" height="9.5" rx="1.5" />
      <path d="M1.5 6h13" />
      <path d="M4 10h2.8" />
    </BaseIcon>
  );
}

export function TransactionsIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M3 4h10" />
      <path d="M3 8h10" />
      <path d="M3 12h10" />
      <circle cx="2" cy="4" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="2" cy="8" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="2" cy="12" r="0.6" fill="currentColor" stroke="none" />
    </BaseIcon>
  );
}

export function BudgetsIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="8" cy="8" r="5.7" />
      <path d="M8 4.6v6.8" />
      <path d="M10.2 6.1c0-.8-.8-1.3-1.9-1.3-1.2 0-2 .5-2 1.3 0 2 3.9 1 3.9 3 0 .8-.8 1.4-2 1.4s-2.1-.6-2.1-1.5" />
    </BaseIcon>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 2.2v1.4" />
      <path d="M8 12.4v1.4" />
      <path d="m3.9 3.9 1 1" />
      <path d="m11.1 11.1 1 1" />
      <path d="M2.2 8h1.4" />
      <path d="M12.4 8h1.4" />
      <path d="m3.9 12.1 1-1" />
      <path d="m11.1 4.9 1-1" />
    </BaseIcon>
  );
}
