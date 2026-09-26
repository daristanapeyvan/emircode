import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';
import { isMenuOpen } from '@/lib/ui/overlays';
import { cn } from '@/lib/utils/cn';

/**
 * The one dialog frame of the app: dimmed backdrop and the panel. Dialogs with their own header
 * (the wizards) use it directly; everything else goes through `Modal`.
 */
export const DialogFrame: React.FC<{
  onBackdropClick?: () => void;
  className?: string;
  labelledBy?: string;
  lang?: string;
  children: React.ReactNode;
}> = ({ onBackdropClick, className, labelledBy, lang, children }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div className="fixed inset-0 bg-black/30 dark:bg-black/60 backdrop-blur-[2px]" onClick={onBackdropClick} />
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      lang={lang}
      className={cn('relative z-10 w-full bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl flex flex-col overflow-hidden', className)}
    >
      {children}
    </div>
  </div>
);

/** Open `Modal`s, oldest first. */
const openDialogs: number[] = [];
let lastDialogId = 0;

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /** Buttons along the bottom edge. */
  footer?: React.ReactNode;
  width?: string;
  /** Classes of the scrolling body (default: padded). */
  bodyClassName?: string;
  /** False: only the close button closes it (no Escape, no click outside), for decisions the user must make. */
  dismissible?: boolean;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'max-w-2xl',
  bodyClassName = 'p-5',
  dismissible = true,
}) => {
  const closeLabel = getTranslations(useSettingsStore((s) => s.settings.language)).common.close;
  const latest = useRef({ onClose, dismissible });
  latest.current = { onClose, dismissible };

  // Escape closes only the top dialog (a details dialog over the model manager, not both).
  useEffect(() => {
    if (!isOpen) return;
    const id = ++lastDialogId;
    openDialogs.push(id);
    // Capture phase: the top dialog answers Escape before the wizards' and the app's own listeners,
    // and marks the key as handled so nothing underneath closes too (an open dropdown goes first).
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isMenuOpen() || openDialogs[openDialogs.length - 1] !== id) return;
      e.preventDefault();
      if (latest.current.dismissible) latest.current.onClose();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      openDialogs.splice(openDialogs.indexOf(id), 1);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const titleId = `modal-${title.replace(/\W+/g, '-').toLowerCase()}`;

  return (
    <DialogFrame onBackdropClick={dismissible ? onClose : undefined} className={cn('max-h-[85vh]', width)} labelledBy={titleId}>
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-zinc-800">
        <div className="min-w-0">
          <h2 id={titleId} className="text-sm font-semibold text-zinc-100 truncate">
            {title}
          </h2>
          {subtitle && <p className="text-xs text-zinc-500 mt-0.5 truncate">{subtitle}</p>}
        </div>
        <IconButton label={closeLabel} icon={<X size={16} strokeWidth={1.5} />} onClick={onClose} size="sm" />
      </div>

      <div className={cn('overflow-y-auto flex-1 min-h-0 text-zinc-300 text-sm', bodyClassName)}>{children}</div>

      {footer && <div className="flex items-center gap-2 px-5 py-3 border-t border-zinc-800">{footer}</div>}
    </DialogFrame>
  );
};
