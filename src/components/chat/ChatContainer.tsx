import React, { useRef, useEffect, useState } from 'react';
import { AlertCircle, RefreshCw, Loader2 } from 'lucide-react';
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

  const [isRetrying, setIsRetrying] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      if (window.electronAPI?.startOllamaService) {
        await window.electronAPI.startOllamaService();
      }
      await checkConnection();
    } finally {
      setIsRetrying(false);
    }
  };

  /** The model of the assistant reply before this one: a name is shown only when it changes. */
  const previousModel = (index: number) => {
    for (let i = index - 1; i >= 0; i--) {
      if (messages[i].role !== 'user') return messages[i].model;
    }
    return undefined;
  };

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
        <div className="bg-red-950/40 border-b border-red-900/50 px-4 py-2 flex items-center justify-between text-xs text-red-300 select-none z-10 shrink-0">
          <div className="flex items-center gap-2">
            <AlertCircle size={14} className="text-red-400 shrink-0" strokeWidth={1.5} />
            <span>{t.settings.ollamaNotDetected}</span>
          </div>
          <button
            type="button"
            disabled={isRetrying}
            onClick={handleRetry}
            className="flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-red-500/15 hover:bg-red-500/25 disabled:opacity-50 text-red-300 font-medium transition-colors cursor-pointer"
          >
            {isRetrying ? (
              <Loader2 size={11} className="animate-spin" strokeWidth={1.5} />
            ) : (
              <RefreshCw size={11} strokeWidth={1.5} />
            )}
            <span>{isRetrying ? t.common.connecting : t.common.retry}</span>
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
            : "py-6"
        )}
      >
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="max-w-3xl mx-auto">
            {messages.map((message, index) => (
              <ChatMessage
                key={message.id}
                message={message}
                isStreaming={isStreaming && message.id === streamingMessageId}
                showModel={message.role !== 'user' && !!message.model && message.model !== previousModel(index)}
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
