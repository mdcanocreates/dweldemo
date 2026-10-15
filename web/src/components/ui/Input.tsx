import type { InputHTMLAttributes } from 'react';

export function Input({
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`h-12 w-full rounded-lg border border-dwel-gray-300 bg-dwel-white px-4 text-base text-dwel-gray-900 placeholder:text-dwel-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-dwel-black ${className}`}
      {...props}
    />
  );
}
