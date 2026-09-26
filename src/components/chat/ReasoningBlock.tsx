import React, { useState } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';
import { cn } from '@/lib/utils/cn';

interface ReasoningBlockProps {
  thinking: string;
  isStreaming?: boolean;
}

/** The model's thinking, folded under one line. */
export const ReasoningBlock: React.FC<ReasoningBlockProps> = ({ thinking, isStreaming }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const language = useSettingsStore((s) => s.settings.language);
  const t = getTranslations(language);

  if (!thinking || !thinking.trim()) return null;

  return (
    <div className="mb-2 text-xs">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer select-none"
      >
        <ChevronRight size={13} strokeWidth={1.5} className={cn('transition-transform', isExpanded && 'rotate-90')} />
        <span>{t.chat.thinking}</span>
        {isStreaming && <Loader2 size={11} className="animate-spin" />}
      </button>

      {isExpanded && (
        <div className="mt-1.5 ml-1.5 pl-3 border-l border-zinc-800 text-zinc-400 whitespace-pre-wrap text-[11px] leading-relaxed max-h-80 overflow-y-auto select-text">
          {thinking.trim()}
        </div>
      )}
    </div>
  );
};
