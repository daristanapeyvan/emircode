import React from 'react';
import { cn } from '@/lib/utils/cn';

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'ghost' | 'secondary' | 'danger';
}

export const IconButton: React.FC<IconButtonProps> = ({
  label,
  icon,
  size = 'md',
  variant = 'ghost',
  className,
  ...props
}) => {
  const sizeClasses = {
    sm: 'w-7 h-7 p-1.5',
    md: 'w-8 h-8 p-1.5',
    lg: 'w-9 h-9 p-2',
  };

  const variantClasses = {
    ghost: 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 active:bg-zinc-800',
    secondary: 'bg-zinc-800/80 border border-zinc-700/60 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700/60',
    danger: 'text-red-400 hover:text-red-300 hover:bg-red-500/10',
  };

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex items-center justify-center rounded transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 disabled:opacity-40 disabled:pointer-events-none cursor-pointer',
        sizeClasses[size],
        variantClasses[variant],
        className
      )}
      {...props}
    >
      {icon}
    </button>
  );
};
