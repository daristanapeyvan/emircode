import React, { useState } from 'react';
import { Copy, Check, RotateCw, Edit2, FileText, User, Sparkles, AlertTriangle, Globe } from 'lucide-react';
import { Message } from '@/types/chat';
import { ReasoningBlock } from './ReasoningBlock';
import { MarkdownContent } from './MarkdownContent';
import { useSettingsStore } from '@/stores/settingsStore';
import { useChatStore } from '@/stores/chatStore';
import { getTranslations } from '@/lib/localization/i18n';
import { formatBytes } from '@/lib/utils/formatters';
import { cn } from '@/lib/utils/cn';

interface ChatMessageProps {
  message: Message;
  isStreaming?: boolean;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ message, isStreaming }) => {
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);

  const { settings } = useSettingsStore();
  const t = getTranslations(settings.language);
  const { regenerateResponse, sendMessage } = useChatStore();

  const isUser = message.role === 'user';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy message:', err);
    }
  };

  const handleSaveEdit = async () => {
    if (editContent.trim() && editContent !== message.content) {
      setIsEditing(false);
      await sendMessage(editContent);
    } else {
      setIsEditing(false);
    }
  };

  return (
    <div
      className={cn(
        'group relative py-4 px-4 transition-colors rounded-lg',
        isUser ? 'bg-zinc-800/30' : 'bg-transparent'
      )}
    >
      <div className="max-w-3xl mx-auto flex gap-3.5">
        {/* Avatar Icon */}
        <div className="shrink-0 mt-0.5">
          {isUser ? (
            <div className="w-6 h-6 rounded bg-zinc-800 border border-zinc-700/60 flex items-center justify-center text-zinc-400">
              <User size={14} strokeWidth={1.5} />
            </div>
          ) : (
            <div className="w-6 h-6 rounded bg-blue-950/60 border border-blue-800/50 flex items-center justify-center text-blue-400">
              <Sparkles size={14} strokeWidth={1.5} />
            </div>
          )}
        </div>

        {/* Message Content Area */}
        <div className="flex-1 min-w-0">
          {/* Header Role & Model Badge */}
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-zinc-300">
                {isUser ? 'You' : message.model || 'Assistant'}
              </span>
              <span className="text-[10px] text-zinc-500 font-mono">
                {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>

            {/* Contextual Action Toolbar (Appears on hover/focus) */}
            <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-center gap-1">
              <button
                type="button"
                onClick={handleCopy}
                title={t.chat.copyMessage}
                className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                {copied ? <Check size={13} className="text-emerald-400" strokeWidth={1.5} /> : <Copy size={13} strokeWidth={1.5} />}
              </button>

              {!isUser && !isStreaming && (
                <button
                  type="button"
                  onClick={() => regenerateResponse()}
                  title={t.chat.regenerate}
                  className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  <RotateCw size={13} strokeWidth={1.5} />
                </button>
              )}

              {isUser && !isStreaming && (
                <button
                  type="button"
                  onClick={() => setIsEditing(!isEditing)}
                  title={t.chat.editPrompt}
                  className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  <Edit2 size={13} strokeWidth={1.5} />
                </button>
              )}
            </div>
          </div>

          {/* Attachments Display */}
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2.5">
              {message.attachments.map((att) => (
                <div
                  key={att.id}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-800/80 border border-zinc-700/60 text-xs text-zinc-300"
                >
                  {att.isImage ? (
                    <img
                      src={att.content.startsWith('data:') ? att.content : `data:image/png;base64,${att.content}`}
                      alt={att.name}
                      className="w-5 h-5 rounded object-cover"
                    />
                  ) : (
                    <FileText size={13} className="text-zinc-400" strokeWidth={1.5} />
                  )}
                  <span className="truncate max-w-[160px] font-mono text-[11px]">{att.name}</span>
                  <span className="text-[10px] text-zinc-500">({formatBytes(att.size)})</span>
                </div>
              ))}
            </div>
          )}

          {/* Web Access / Activity Indicator */}
          {message.webActivity && message.webActivity.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {message.webActivity.map((act, idx) => (
                <div
                  key={idx}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-zinc-850 border border-zinc-750 text-[11px] text-zinc-400 select-none"
                >
                  <Globe size={11} className="text-blue-400 shrink-0" strokeWidth={1.5} />
                  {act.type === 'search' ? (
                    <span>
                      Web Arama: <span className="text-zinc-200 font-medium">"{act.query}"</span> ({act.resultsCount ?? 0} sonuç)
                    </span>
                  ) : (
                    <span>
                      Web Sayfası: <span className="text-zinc-200 font-medium truncate max-w-[200px] inline-block align-bottom">{act.url}</span> {act.sizeKb ? `(${act.sizeKb} KB)` : ''}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Reasoning / Thinking Section (if present) */}
          {message.thinking && (
            <ReasoningBlock thinking={message.thinking} isStreaming={isStreaming} />
          )}

          {/* Message Body */}
          {isEditing ? (
            <div className="mt-2 space-y-2">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full p-2.5 bg-zinc-900 border border-zinc-700 rounded text-sm text-zinc-100 font-sans focus:outline-none focus:border-blue-500 resize-y"
                rows={3}
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded"
                >
                  {t.common.save}
                </button>
              </div>
            </div>
          ) : isUser ? (
            <div className="text-sm text-zinc-100 whitespace-pre-wrap leading-relaxed selectable-text font-sans">
              {message.content}
            </div>
          ) : (
            <div className="selectable-text">
              <MarkdownContent content={message.content} />
              {isStreaming && (
                <span className="inline-block w-1.5 h-4 ml-1 align-middle bg-blue-500 animate-pulse" />
              )}
            </div>
          )}

          {/* Error display */}
          {message.error && (
            <div className="mt-2 p-2.5 rounded bg-red-950/30 border border-red-900/40 text-xs text-red-400 flex items-start gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" strokeWidth={1.5} />
              <div>
                <span className="font-medium">Generation Error: </span>
                <span>{message.error}</span>
              </div>
            </div>
          )}

          {/* Generation Metadata (Measured values only, never fabricated) */}
          {!isUser && settings.showMetadata && message.metadata && (
            <div className="mt-2 pt-1 flex items-center gap-3 text-[11px] font-mono text-zinc-500 select-none">
              {message.metadata.evalCount ? (
                <span>
                  {message.metadata.evalCount} {t.chat.totalTokens}
                </span>
              ) : null}
              {message.metadata.tokensPerSecond ? (
                <span>
                  · {message.metadata.tokensPerSecond} {t.chat.tokensPerSecond}
                </span>
              ) : null}
              {message.metadata.durationSeconds ? (
                <span>· {message.metadata.durationSeconds}s</span>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
