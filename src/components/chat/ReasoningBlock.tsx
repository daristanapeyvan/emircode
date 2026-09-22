import React, { useState } from 'react';
import { ChevronRight, BrainCircuit } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

interface ReasoningBlockProps {
  thinking: string;
  isStreaming?: boolean;
}

export const ReasoningBlock: React.FC<ReasoningBlockProps> = ({ thinking, isStreaming }) => {
  // Collapsed by default unless currently streaming the initial thought
  const [isExpanded, setIsExpanded] = useState(false);

  if (!thinking || !thinking.trim()) return null;

  return (
    <div className="my-2 border border-zinc-800/40 bg-zinc-900/30 rounded-md overflow-hidden text-xs">
      {/* Header Accordion */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3 py-2 flex items-center justify-between text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer select-none"
      >
        <div className="flex items-center gap-2">
          <BrainCircuit size={14} className="text-zinc-500" strokeWidth={1.5} />
          <span className="font-medium tracking-wide">Reasoning</span>
          {isStreaming && (
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
          )}
        </div>

        <ChevronRight
          size={14}
          strokeWidth={1.5}
          className={cn('transition-transform duration-200 text-zinc-500', isExpanded && 'rotate-90')}
        />
      </button>

      {/* Collapsed/Expanded Content */}
      {isExpanded && (
        <div className="px-3.5 py-2.5 border-t border-zinc-800/60 bg-zinc-950/40 text-zinc-400 whitespace-pre-wrap font-mono text-[11px] leading-relaxed max-h-80 overflow-y-auto selectable-text">
          {thinking.trim()}
        </div>
      )}
    </div>
  );
};
