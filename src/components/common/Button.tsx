import React from 'react';
import { cn } from '@/lib/utils/cn';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  ...props
}) => {
  const sizeClasses = {
    sm: 'h-7 px-2.5 text-xs gap-1.5',
    md: 'h-8 px-3 text-sm gap-2',
    lg: 'h-9 px-4 text-sm gap-2',
  };

  const variantClasses = {
    primary: 'bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-sm border border-blue-500/20 active:bg-blue-700',
    secondary: 'bg-zinc-800 hover:bg-zinc-700/80 text-zinc-200 border border-zinc-700/60 active:bg-zinc-700',
    ghost: 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 active:bg-zinc-800',
    danger: 'bg-red-950/40 hover:bg-red-900/50 text-red-300 border border-red-800/50 active:bg-red-900',
  };

  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center justify-center rounded font-normal transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 disabled:opacity-40 disabled:pointer-events-none cursor-pointer',
        sizeClasses[size],
        variantClasses[variant],
        className
      )}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </button>
  );
};
