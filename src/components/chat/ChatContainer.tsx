import React, { useRef, useEffect } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { ChatMessage } from './ChatMessage';
import { Composer } from './Composer';
import { EmptyState } from './EmptyState';
import { SystemPromptPopover } from './SystemPromptPopover';
import { useChatStore } from '@/stores/chatStore';
import { useModelStore } from '@/stores/modelStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';
import { cn } from '@/lib/utils/cn';

export const ChatContainer: React.FC = () => {
  const { messages, isStreaming, streamingMessageId } = useChatStore();
  const { connectionStatus, checkConnection } = useModelStore();
  const { settings } = useSettingsStore();
  const t = getTranslations(settings.language);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new message / streaming token
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isStreaming]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-zinc-950/30 relative">
      {/* System prompt popover */}
      <SystemPromptPopover />

      {/* Connection Failure Banner (Subtle, only when truly disconnected) */}
      {connectionStatus === 'disconnected' && (
        <div className="bg-rose-950/60 border-b border-rose-900/60 px-4 py-2 flex items-center justify-between text-xs text-rose-300 select-none z-10 shrink-0">
          <div className="flex items-center gap-2">
            <AlertCircle size={14} className="text-rose-400 shrink-0" strokeWidth={1.5} />
            <span>{t.settings.ollamaNotDetected}</span>
          </div>
          <button
            type="button"
            onClick={() => checkConnection()}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-rose-900/80 hover:bg-rose-800 text-white font-medium transition-colors cursor-pointer"
          >
            <RefreshCw size={11} strokeWidth={1.5} />
            <span>{t.common.retry}</span>
          </button>
        </div>
      )}

      {/* Messages Scroll Area */}
      <div
        ref={containerRef}
        className={cn(
          "flex-1 overflow-y-auto px-4",
          messages.length === 0
            ? "flex flex-col items-center justify-center min-h-0"
            : "py-6 space-y-1"
        )}
      >
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="max-w-3xl mx-auto space-y-1">
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                isStreaming={isStreaming && message.id === streamingMessageId}
              />
            ))}
            <div ref={messagesEndRef} className="h-4" />
          </div>
        )}
      </div>

      {/* Bottom Composer */}
      <Composer />
    </div>
  );
};
