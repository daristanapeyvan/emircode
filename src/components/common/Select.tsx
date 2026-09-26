import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { menuClosed, menuOpened } from '@/lib/ui/overlays';
import { cn } from '@/lib/utils/cn';

export interface SelectOption<T extends string | number = string> {
  value: T;
  label: string;
}

export interface SelectGroup<T extends string | number = string> {
  label: string;
  options: SelectOption<T>[];
}

interface SelectProps<T extends string | number> {
  value: T;
  onChange: (value: T) => void;
  /** Plain options, or labelled groups (like <optgroup>). */
  options: Array<SelectOption<T> | SelectGroup<T>>;
  ariaLabel?: string;
  id?: string;
  disabled?: boolean;
  /** field: a bordered box (settings, forms); bare: text with a chevron (toolbars). */
  variant?: 'field' | 'bare';
  className?: string;
}

const isGroup = <T extends string | number>(item: SelectOption<T> | SelectGroup<T>): item is SelectGroup<T> =>
  (item as SelectGroup<T>).options !== undefined;

const MENU_MAX_HEIGHT = 288;

/**
 * The app's own dropdown in place of the operating system's <select> list: same colors and corners
 * as the rest of the app in both themes, keyboard friendly (arrows, Home/End, Enter, Escape, typing
 * a letter), and drawn above dialogs so a scrolling settings page cannot clip it.
 */
export function Select<T extends string | number>({ value, onChange, options, ariaLabel, id, disabled, variant = 'field', className }: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<{ left: number; top: number; minWidth: number; maxHeight: number; above: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const flat = useMemo(() => options.flatMap((item) => (isGroup(item) ? item.options : [item])), [options]);
  const selectedIndex = flat.findIndex((o) => o.value === value);
  const selected = flat[selectedIndex];

  const close = useCallback((focusTrigger = true) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const openAbove = below < 160 && above > below;
    setPosition({
      left: Math.min(r.left, window.innerWidth - 8 - Math.max(r.width, 160)),
      top: openAbove ? r.top - 4 : r.bottom + 4,
      minWidth: r.width,
      maxHeight: Math.min(MENU_MAX_HEIGHT, openAbove ? above : below),
      above: openAbove,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    setActive(Math.max(0, selectedIndex));
    menuOpened();
    requestAnimationFrame(() => menuRef.current?.focus());
    return () => menuClosed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Clicks elsewhere, scrolling and resizing close it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    const onScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      close(false);
    };
    const onResize = () => close(false);
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, close]);

  // Keep the highlighted option in view.
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (index: number) => {
    const option = flat[index];
    if (!option) return;
    close();
    if (option.value !== value) onChange(option.value);
  };

  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    const last = flat.length - 1;
    if (e.key === 'ArrowDown') setActive((i) => Math.min(last, i + 1));
    else if (e.key === 'ArrowUp') setActive((i) => Math.max(0, i - 1));
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(last);
    else if (e.key === 'Enter' || e.key === ' ') choose(active);
    else if (e.key === 'Escape') close();
    else if (e.key === 'Tab') close(false);
    else if (e.key.length === 1) {
      // Typing a letter jumps to the next option that starts with it.
      const letter = e.key.toLocaleLowerCase();
      const next = flat.findIndex((o, i) => i > active && o.label.toLocaleLowerCase().startsWith(letter));
      const wrap = flat.findIndex((o) => o.label.toLocaleLowerCase().startsWith(letter));
      const target = next >= 0 ? next : wrap;
      if (target >= 0) setActive(target);
      else return;
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  let index = -1;
  const renderOption = (option: SelectOption<T>) => {
    index++;
    const i = index;
    const isSelected = option.value === value;
    return (
      <div
        key={String(option.value)}
        id={id ? `${id}-option-${i}` : undefined}
        role="option"
        aria-selected={isSelected}
        data-index={i}
        onMouseEnter={() => setActive(i)}
        onClick={() => choose(i)}
        className={cn(
          'flex items-center justify-between gap-3 px-2.5 py-1.5 rounded text-xs cursor-pointer select-none',
          i === active ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300',
          isSelected && 'font-medium text-zinc-100'
        )}
      >
        <span className="truncate">{option.label}</span>
        {isSelected ? <Check size={13} strokeWidth={2} className="shrink-0 text-zinc-300" /> : <span className="w-[13px] shrink-0" />}
      </div>
    );
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKey}
        className={cn(
          'inline-flex items-center justify-between gap-2 text-xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500',
          variant === 'field'
            ? 'h-8 px-2.5 max-w-[240px] rounded bg-zinc-900 border border-zinc-750 text-zinc-200 hover:border-zinc-600'
            : 'h-7 px-1.5 -mx-1.5 rounded text-zinc-200 hover:bg-zinc-800/60',
          className
        )}
      >
        <span className="truncate">{selected?.label ?? ''}</span>
        <ChevronDown size={variant === 'field' ? 14 : 12} strokeWidth={1.75} className={cn('shrink-0 text-zinc-500 transition-transform', open && 'rotate-180')} />
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            tabIndex={-1}
            aria-label={ariaLabel}
            aria-activedescendant={id ? `${id}-option-${active}` : undefined}
            onKeyDown={onMenuKey}
            className="fixed z-[70] overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900 p-1 shadow-xl focus:outline-none"
            style={{
              left: position.left,
              top: position.top,
              minWidth: Math.max(position.minWidth, 160),
              maxHeight: position.maxHeight,
              transform: position.above ? 'translateY(-100%)' : undefined,
            }}
          >
            {options.map((item) =>
              isGroup(item) ? (
                <div key={`group-${item.label}`} role="group" aria-label={item.label}>
                  <div className="px-2.5 pt-2 pb-1 text-[11px] font-medium text-zinc-500 select-none">{item.label}</div>
                  {item.options.map(renderOption)}
                </div>
              ) : (
                renderOption(item)
              )
            )}
          </div>,
          document.body
        )}
    </>
  );
}
