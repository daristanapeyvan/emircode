import React from 'react';
import { cn } from '@/lib/utils/cn';

interface SettingsRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export const SettingsRow: React.FC<SettingsRowProps> = ({ label, description, children, className }) => {
  return (
    <div className={cn('py-3.5 border-b border-zinc-800/60 last:border-b-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3', className)}>
      <div className="space-y-0.5 max-w-sm">
        <label className="text-xs font-medium text-zinc-200 block">{label}</label>
        {description && <p className="text-[11px] text-zinc-500 leading-normal">{description}</p>}
      </div>

      <div className="shrink-0 flex items-center">{children}</div>
    </div>
  );
};

/** A slider with its value to the right. */
export const RangeControl: React.FC<{
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  label: string;
}> = ({ value, min, max, step, onChange, label }) => (
  <div className="flex items-center gap-3 w-56">
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="flex-1 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-accent"
    />
    <span className="w-10 text-right text-xs text-zinc-300 tabular-nums">{value}</span>
  </div>
);
