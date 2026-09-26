import React, { useState } from 'react';
import { Copy, Check, RotateCw, Edit2, FileText, AlertTriangle, Globe } from 'lucide-react';
import { Message } from '@/types/chat';
import { ReasoningBlock } from './ReasoningBlock';
import { MarkdownContent } from './MarkdownContent';
import { useSettingsStore } from '@/stores/settingsStore';
import { useChatStore } from '@/stores/chatStore';
import { getTranslations } from '@/lib/localization/i18n';
import { formatBytes } from '@/lib/utils/formatters';
import { cleanChatContent } from '@/lib/web/WebIntentDetector';
import { Button } from '../common/Button';
import { cn } from '@/lib/utils/cn';

interface ChatMessageProps {
  message: Message;
  isStreaming?: boolean;
  /** Name the model above this reply (it answered after a different one, or first). */
  showModel?: boolean;
}

const toolButton = 'p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer';

export const ChatMessage: React.FC<ChatMessageProps> = ({ message, isStreaming, showModel }) => {
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

  const meta = !isUser && settings.showMetadata ? message.metadata : undefined;
  const metaText = [
    meta?.tokensPerSecond ? `${meta.tokensPerSecond} ${t.chat.tokensPerSecond}` : '',
    meta?.durationSeconds ? `${meta.durationSeconds} ${t.chat.secondsShort}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={cn('group py-3', isUser && 'flex flex-col items-end')}>
      {showModel && <p className="mb-1 text-[11px] font-mono text-zinc-500">{message.model}</p>}

      {message.attachments && message.attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {message.attachments.map((att) => (
            <div key={att.id} className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-800 text-xs text-zinc-300">
              {att.isImage ? (
                <img
                  src={att.content.startsWith('data:') ? att.content : `data:image/png;base64,${att.content}`}
                  alt={att.name}
                  className="w-5 h-5 rounded-sm object-cover"
                />
              ) : (
                <FileText size={13} className="text-zinc-400" strokeWidth={1.5} />
              )}
              <span className="truncate max-w-[160px]">{att.name}</span>
              <span className="text-[11px] text-zinc-500">{formatBytes(att.size)}</span>
            </div>
          ))}
        </div>
      )}

      {message.webActivity && message.webActivity.length > 0 && (
        <div className="mb-2 space-y-0.5">
          {message.webActivity.map((act, idx) => (
            <p key={idx} className="flex items-center gap-1.5 text-[11px] text-zinc-500 min-w-0">
              <Globe size={11} className="shrink-0" strokeWidth={1.5} />
              <span className="truncate">
                {act.type === 'search'
                  ? t.chat.webSearched.replace('{query}', act.query || '').replace('{count}', String(act.resultsCount ?? 0))
                  : t.chat.webFetched.replace('{url}', act.url || '')}
              </span>
            </p>
          ))}
        </div>
      )}

      {message.thinking && <ReasoningBlock thinking={message.thinking} isStreaming={isStreaming} />}

      {isEditing ? (
        <div className="w-full space-y-2">
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full p-2.5 bg-zinc-900 border border-zinc-700 rounded text-sm text-zinc-100 focus:outline-none focus:border-zinc-500 resize-y"
            rows={3}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
              {t.common.cancel}
            </Button>
            <Button variant="primary" size="sm" onClick={handleSaveEdit}>
              {t.common.save}
            </Button>
          </div>
        </div>
      ) : isUser ? (
        <div className="max-w-[85%] rounded-md bg-zinc-800/50 px-3.5 py-2.5 text-sm text-zinc-100 whitespace-pre-wrap leading-relaxed select-text">
          {message.content}
        </div>
      ) : (
        <div className="select-text">
          <MarkdownContent content={cleanChatContent(message.content)} />
          {isStreaming && <span className="inline-block w-1.5 h-4 ml-1 align-middle bg-zinc-400 animate-pulse" />}
        </div>
      )}

      {message.error && (
        <p className="mt-2 flex items-start gap-2 text-xs text-red-400">
          <AlertTriangle size={14} className="shrink-0 mt-px" strokeWidth={1.5} />
          <span>
            {t.chat.generationError} {message.error}
          </span>
        </p>
      )}

      {/* Time, speed and actions on hover */}
      {!isStreaming && !isEditing && (
        <div className="mt-1 flex items-center gap-1 h-6 text-[11px] text-zinc-500 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <span className="tabular-nums mr-1">
            {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            {metaText && ` · ${metaText}`}
          </span>
          <button type="button" onClick={handleCopy} title={t.chat.copyMessage} aria-label={t.chat.copyMessage} className={toolButton}>
            {copied ? <Check size={13} strokeWidth={1.5} /> : <Copy size={13} strokeWidth={1.5} />}
          </button>
          {isUser ? (
            <button type="button" onClick={() => setIsEditing(true)} title={t.chat.editPrompt} aria-label={t.chat.editPrompt} className={toolButton}>
              <Edit2 size={13} strokeWidth={1.5} />
            </button>
          ) : (
            <button type="button" onClick={() => regenerateResponse()} title={t.chat.regenerate} aria-label={t.chat.regenerate} className={toolButton}>
              <RotateCw size={13} strokeWidth={1.5} />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
