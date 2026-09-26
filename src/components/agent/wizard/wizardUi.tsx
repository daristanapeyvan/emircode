import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { RichTextLabels } from '@/components/common/RichTextArea';
import type { WizardText } from './SiteWizard';

// The same controls as Settings, so the wizards look like the rest of the app.
export const inputClass =
  'w-full h-8 px-3 rounded bg-zinc-900 border border-zinc-750 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors selectable-text';
export const textareaClass =
  'w-full px-3 py-2 rounded bg-zinc-900 border border-zinc-750 text-xs leading-relaxed text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors resize-y selectable-text';

export const Field: React.FC<{
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}> = ({ label, htmlFor, hint, error, required, className, children }) => (
  <div className={cn('space-y-1.5', className)}>
    <label htmlFor={htmlFor} className="flex items-center gap-1 text-xs font-medium text-zinc-300">
      {label}
      {required && <span className="text-zinc-500" aria-hidden="true">*</span>}
    </label>
    {children}
    {error ? (
      <p className="text-[11px] text-amber-400" role="alert">
        {error}
      </p>
    ) : hint ? (
      <p className="text-[11px] text-zinc-500 leading-relaxed">{hint}</p>
    ) : null}
  </div>
);

export const StepHeader: React.FC<{ title: string; description?: string }> = ({ title, description }) => (
  <div className="mb-5">
    <h3 className="text-[15px] font-semibold text-zinc-100 tracking-tight">{title}</h3>
    {description && <p className="text-xs text-zinc-400 mt-1 leading-relaxed max-w-2xl">{description}</p>}
  </div>
);

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  size = 'md',
}: {
  value: T;
  options: Array<{ value: T; label: string; title?: string }>;
  onChange: (value: T) => void;
  ariaLabel: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex items-center rounded-lg bg-zinc-950/70 border border-zinc-800 p-0.5">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={opt.title}
            onClick={() => onChange(opt.value)}
            className={cn(
              'rounded-md font-medium transition-colors cursor-pointer',
              size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs',
              active ? 'bg-zinc-100 text-zinc-900 shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export const Chip: React.FC<{
  selected?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}> = ({ selected, onClick, children, title }) => (
  <button
    type="button"
    aria-pressed={!!selected}
    title={title}
    onClick={onClick}
    className={cn(
      'inline-flex items-center gap-1.5 h-7 px-2.5 rounded border text-xs transition-colors cursor-pointer',
      selected
        ? 'bg-zinc-700/80 border-zinc-600 text-zinc-100'
        : 'bg-transparent border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
    )}
  >
    {children}
  </button>
);

/** A button that opens a small list of choices (page templates, section kinds). */
export const MenuButton: React.FC<{
  label: string;
  icon?: React.ReactNode;
  items: Array<{ id: string; label: string; hint?: string }>;
  onPick: (id: string) => void;
  align?: 'left' | 'right';
}> = ({ label, icon, items, onPick, align = 'left' }) => {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  return (
    <div ref={wrap} className="relative inline-block">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-dashed border-zinc-700 text-xs text-zinc-300 hover:text-zinc-100 hover:border-zinc-500 hover:bg-zinc-800/40 transition-colors cursor-pointer"
      >
        {icon}
        {label}
        <ChevronDown size={12} className="text-zinc-500" />
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute z-20 mt-1.5 w-56 max-h-72 overflow-y-auto rounded-lg border border-zinc-700/80 bg-zinc-900 shadow-2xl p-1',
            align === 'right' ? 'right-0' : 'left-0'
          )}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onPick(item.id);
              }}
              className="w-full text-left px-2.5 py-1.5 rounded-md text-xs text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <span className="block">{item.label}</span>
              {item.hint && <span className="block text-[10.5px] text-zinc-500 mt-0.5">{item.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/** Small square icon button used for reorder / remove actions. */
export const IconAction: React.FC<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}> = ({ label, onClick, disabled, danger, children }) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    disabled={disabled}
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    className={cn(
      'p-1 rounded-md transition-colors cursor-pointer disabled:opacity-25 disabled:cursor-default disabled:hover:bg-transparent',
      danger ? 'text-zinc-500 hover:text-red-300 hover:bg-red-950/40' : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800'
    )}
  >
    {children}
  </button>
);

/** A settings row: label (and a short description) on the left, the control on the right. */
export const SettingRow: React.FC<{
  label: string;
  htmlFor?: string;
  description?: string;
  /** Control below the label (lists, chip groups) instead of beside it. */
  stacked?: boolean;
  children: React.ReactNode;
}> = ({ label, htmlFor, description, stacked, children }) => (
  <div className={cn('py-3 border-b border-zinc-800/40 last:border-b-0', stacked ? 'space-y-2' : 'flex items-center justify-between gap-4')}>
    <div className="min-w-0 space-y-0.5">
      <label htmlFor={htmlFor} className="block text-xs font-medium text-zinc-200">
        {label}
      </label>
      {description && <p className="text-[11px] text-zinc-500 leading-normal">{description}</p>}
    </div>
    <div className={stacked ? '' : 'shrink-0 flex items-center gap-2'}>{children}</div>
  </div>
);

export const SectionTitle: React.FC<{ children: React.ReactNode; action?: React.ReactNode }> = ({ children, action }) => (
  <div className="flex items-center justify-between pt-4 pb-1">
    <h4 className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">{children}</h4>
    {action}
  </div>
);

/** "{count} sayfa" style replacement. */
export const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (m, key) => (key in values ? String(values[key]) : m));

/** Toolbar labels of the smart text box in the wizard's language. */
export const editorLabels = (w: WizardText): RichTextLabels => ({
  bold: w.editorBold,
  italic: w.editorItalic,
  heading: w.editorHeading,
  bullets: w.editorBullets,
  numbers: w.editorNumbers,
  quote: w.editorQuote,
  link: w.editorLink,
  preview: w.editorPreview,
  write: w.editorWrite,
  emptyPreview: w.editorEmptyPreview,
  count: w.editorCount,
  boldPlaceholder: w.editorBoldPlaceholder,
  italicPlaceholder: w.editorItalicPlaceholder,
  linkPlaceholder: w.editorLinkPlaceholder,
});
