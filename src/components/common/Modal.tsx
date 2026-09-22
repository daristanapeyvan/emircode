import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';
import { cn } from '@/lib/utils/cn';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  width?: string;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  width = 'max-w-2xl',
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-[2px] transition-opacity"
        onClick={onClose}
      />

      {/* Dialog Window */}
      <div
        className={cn(
          'relative w-full bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl overflow-hidden flex flex-col z-10 max-h-[85vh]',
          width
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800/80 bg-zinc-900/90">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100 tracking-tight">{title}</h2>
            {subtitle && <p className="text-xs text-zinc-400 mt-0.5">{subtitle}</p>}
          </div>
          <IconButton
            label="Close"
            icon={<X size={16} strokeWidth={1.5} />}
            onClick={onClose}
            size="sm"
          />
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 p-5 text-zinc-300 text-sm">
          {children}
        </div>
      </div>
    </div>
  );
};
