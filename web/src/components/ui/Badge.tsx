import type { ReactNode } from 'react';

type Tone = 'neutral' | 'mint' | 'amber' | 'red' | 'blue' | 'gray';

const tones: Record<Tone, string> = {
  neutral: 'bg-dwel-surface2 text-dwel-muted',
  mint: 'bg-dwel-mint-soft text-dwel-success',
  amber: 'bg-[#fff7e6] text-[#94610d]',
  red: 'bg-[#fff0f0] text-[#b2383e]',
  blue: 'bg-[#edf4ff] text-[#285cb1]',
  gray: 'bg-dwel-gray-200 text-dwel-gray-600',
};

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
