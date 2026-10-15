import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';

const variants: Record<Variant, string> = {
  primary:
    'bg-dwel-black text-dwel-white hover:bg-dwel-gray-900 shadow-[var(--shadow-mint-cta)]',
  secondary:
    'border border-dwel-black text-dwel-black bg-dwel-white hover:bg-dwel-gray-50',
  ghost: 'text-dwel-black underline underline-offset-2 font-semibold px-0 py-0 rounded-none',
  destructive: 'bg-dwel-red text-white hover:bg-red-600',
};

export function Button({
  variant = 'primary',
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  children: ReactNode;
}) {
  const base =
    variant === 'ghost'
      ? 'inline-flex items-center justify-center font-semibold disabled:opacity-50'
      : 'inline-flex items-center justify-center rounded-full px-6 py-3 font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed';
  return (
    <button type="button" className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}
