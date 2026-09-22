import React from 'react';
import { cn } from '@/lib/utils/cn';

interface SettingsRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export const SettingsRow: React.FC<SettingsRowProps> = ({
  label,
  description,
  children,
  className,
}) => {
  return (
    <div
      className={cn(
        'py-3.5 border-b border-zinc-800/40 last:border-b-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3',
        className
      )}
    >
      <div className="space-y-0.5 max-w-sm">
        <label className="text-xs font-medium text-zinc-200 block">{label}</label>
        {description && (
          <p className="text-[11px] text-zinc-500 leading-normal">{description}</p>
        )}
      </div>

      <div className="shrink-0 flex items-center">{children}</div>
    </div>
  );
};
