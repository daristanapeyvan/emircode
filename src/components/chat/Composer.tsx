import React, { useState, useRef, useEffect } from 'react';
import { Paperclip, ArrowUp, Square, Globe, ScrollText } from 'lucide-react';
import { AttachmentTray } from './AttachmentTray';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useModelStore } from '@/stores/modelStore';
import { useUIStore } from '@/stores/uiStore';
import { noticeDialog } from '@/lib/ui/dialogs';
import { getTranslations } from '@/lib/localization/i18n';
import { Attachment } from '@/types/chat';
import { DEFAULT_SETTINGS } from '@/types/settings';
import { cn } from '@/lib/utils/cn';

/** A square button of the composer; a switched-on one is blue. */
const toolClass = (active: boolean) =>
  cn(
    'inline-flex items-center justify-center w-8 h-8 shrink-0 rounded transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none',
    active ? 'bg-blue-500/15 text-blue-400 hover:bg-blue-500/25' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60'
  );

export const Composer: React.FC = () => {
  const [content, setContent] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { isStreaming, sendMessage, stopStreaming, interruptAndSend, addAttachment, attachments } = useChatStore();
  const { selectedModelDetails, selectedModel } = useModelStore();
  const { settings, setWebAccess } = useSettingsStore();
  const t = getTranslations(settings.language);
  const toggleSystemPrompt = useUIStore((s) => s.toggleSystemPrompt);
  const activeChatId = useChatStore((s) => s.activeChatId);
  const hasSystemPrompt = useChatStore((s) => !!s.chats.find((c) => c.id === s.activeChatId)?.systemPrompt?.trim());
  const webAccess = settings.webAccess || DEFAULT_SETTINGS.webAccess;
  const webOn = webAccess.enabled && webAccess.chatEnabled;

  // Auto-resize textarea height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.min(scrollHeight, 180)}px`;
    }
  }, [content]);

  // Focus on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSend = () => {
    if (isStreaming) {
      if (content.trim()) {
        const textToSend = content;
        setContent('');
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
        }
        interruptAndSend(textToSend);
      } else {
        stopStreaming();
      }
      return;
    }

    if (!content.trim() && useChatStore.getState().attachments.length === 0) {
      return;
    }

    const textToSend = content;
    setContent('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    sendMessage(textToSend);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      if (settings.sendOnEnter) {
        if (!e.shiftKey) {
          e.preventDefault();
          handleSend();
        }
      } else {
        if (e.ctrlKey) {
          e.preventDefault();
          handleSend();
        }
      }
    }
  };

  // Attach files handler
  const processFiles = async (files: FileList | File[]) => {
    const supportsVision = selectedModelDetails?.capabilities?.includes('vision') ?? false;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isImage = file.type.startsWith('image/');

      if (isImage && !supportsVision) {
        void noticeDialog({ title: t.chat.imageNotAddedTitle, message: t.chat.visionNotSupported });
        continue;
      }

      if (isImage) {
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = reader.result as string;
          const att: Attachment = {
            id: `att_${Date.now()}_${i}`,
            name: file.name,
            size: file.size,
            type: file.type,
            content: base64,
            isImage: true,
          };
          addAttachment(att);
        };
        reader.readAsDataURL(file);
      } else {
        const reader = new FileReader();
        reader.onload = () => {
          const text = reader.result as string;
          const att: Attachment = {
            id: `att_${Date.now()}_${i}`,
            name: file.name,
            size: file.size,
            type: file.type,
            content: text,
            isImage: false,
          };
          addAttachment(att);
        };
        reader.readAsText(file);
      }
    }
  };

  const handleNativeAttachment = async () => {
    if (window.electronAPI?.openFileDialog) {
      const res = await window.electronAPI.openFileDialog({
        title: t.chat.attachFile,
        multiSelections: true,
      });

      if (res.success && res.files) {
        const supportsVision = selectedModelDetails?.capabilities?.includes('vision') ?? false;
        for (const file of res.files) {
          const isImage = /\.(png|jpe?g|webp|gif)$/i.test(file.name);
          if (isImage && !supportsVision) {
            void noticeDialog({ title: t.chat.imageNotAddedTitle, message: t.chat.visionNotSupported });
            continue;
          }
          addAttachment({
            id: `att_${Date.now()}_${Math.random()}`,
            name: file.name,
            size: file.size,
            type: isImage ? 'image/png' : 'text/plain',
            content: file.content,
            isImage,
          });
        }
      }
    } else {
      fileInputRef.current?.click();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const fileList: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) fileList.push(file);
      }
    }
    if (fileList.length > 0) {
      processFiles(fileList);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  return (
    <div className="px-4 pb-4 shrink-0">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={cn(
          'max-w-3xl mx-auto rounded-lg border bg-zinc-900 transition-colors',
          isDragging ? 'border-blue-500' : 'border-zinc-800 focus-within:border-zinc-700'
        )}
      >
        {/* Attachment preview tray */}
        <AttachmentTray />

        {/* Input area */}
        <div className="flex items-end gap-1 p-2">
          <button
            type="button"
            onClick={handleNativeAttachment}
            title={t.chat.attachFile}
            aria-label={t.chat.attachFile}
            className={toolClass(false)}
          >
            <Paperclip size={16} strokeWidth={1.5} />
          </button>
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            multiple
            onChange={(e) => e.target.files && processFiles(e.target.files)}
          />

          <button
            type="button"
            onClick={toggleSystemPrompt}
            disabled={!activeChatId}
            title={t.chat.systemInstructions}
            aria-label={t.chat.systemInstructions}
            aria-pressed={hasSystemPrompt}
            className={toolClass(hasSystemPrompt)}
          >
            <ScrollText size={16} strokeWidth={1.5} />
          </button>

          <button
            type="button"
            onClick={() => setWebAccess({ enabled: !webOn, chatEnabled: !webOn })}
            title={webOn ? t.chat.webOn : t.chat.webOff}
            aria-label={webOn ? t.chat.webOn : t.chat.webOff}
            aria-pressed={webOn}
            className={toolClass(webOn)}
          >
            <Globe size={16} strokeWidth={1.5} />
          </button>

          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={!selectedModel ? t.chat.selectModelFirst : isStreaming ? t.agent.interruptPlaceholder : t.chat.inputPlaceholder}
            disabled={!selectedModel}
            rows={1}
            className="flex-1 min-w-0 bg-transparent border-0 px-1.5 py-1.5 text-sm leading-5 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-0 resize-none max-h-44"
          />

          {isStreaming && (
            <button
              type="button"
              onClick={stopStreaming}
              title={t.chat.stop}
              aria-label={t.chat.stop}
              className="inline-flex items-center justify-center w-8 h-8 shrink-0 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors cursor-pointer"
            >
              <Square size={14} strokeWidth={2} />
            </button>
          )}
          <button
            type="button"
            onClick={handleSend}
            disabled={!content.trim() && (isStreaming || attachments.length === 0)}
            title={isStreaming ? t.chat.interruptAndSend : t.chat.send}
            aria-label={isStreaming ? t.chat.interruptAndSend : t.chat.send}
            className="inline-flex items-center justify-center w-8 h-8 shrink-0 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer"
          >
            <ArrowUp size={16} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
};
