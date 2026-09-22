import React, { useState, useRef, useEffect } from 'react';
import { Paperclip, ArrowUp, Square } from 'lucide-react';
import { AttachmentTray } from './AttachmentTray';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useModelStore } from '@/stores/modelStore';
import { getTranslations } from '@/lib/localization/i18n';
import { Attachment } from '@/types/chat';
import { cn } from '@/lib/utils/cn';

export const Composer: React.FC = () => {
  const [content, setContent] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { isStreaming, sendMessage, stopStreaming, addAttachment } = useChatStore();
  const { selectedModelDetails, selectedModel } = useModelStore();
  const { settings } = useSettingsStore();
  const t = getTranslations(settings.language);

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
      stopStreaming();
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
        alert(t.chat.visionNotSupported);
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
        title: 'Attach File',
        multiSelections: true,
      });

      if (res.success && res.files) {
        const supportsVision = selectedModelDetails?.capabilities?.includes('vision') ?? false;
        for (const file of res.files) {
          const isImage = /\.(png|jpe?g|webp|gif)$/i.test(file.name);
          if (isImage && !supportsVision) {
            alert(t.chat.visionNotSupported);
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
    <div className="p-4 bg-transparent shrink-0">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={cn(
          'max-w-3xl mx-auto rounded-xl border bg-zinc-900/90 shadow-sm overflow-hidden transition-all duration-150',
          isDragging
            ? 'border-blue-500 bg-blue-950/20'
            : 'border-zinc-800/40 focus-within:border-zinc-700/60 focus-within:ring-1 focus-within:ring-zinc-700/30'
        )}
      >
        {/* Attachment preview tray */}
        <AttachmentTray />

        {/* Input area */}
        <div className="flex items-end px-3 py-2 gap-2">
          {/* Attachment Button */}
          <button
            type="button"
            onClick={handleNativeAttachment}
            title={t.chat.attachFile}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80 transition-colors cursor-pointer shrink-0 mb-0.5"
          >
            <Paperclip size={18} strokeWidth={1.5} />
          </button>
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            multiple
            onChange={(e) => e.target.files && processFiles(e.target.files)}
          />

          {/* Multiline textarea */}
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              !selectedModel
                ? t.chat.selectModelFirst
                : t.chat.inputPlaceholder
            }
            disabled={!selectedModel}
            rows={1}
            className="flex-1 bg-transparent border-0 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-0 resize-none max-h-44 py-1.5 leading-relaxed font-sans selectable-text"
          />

          {/* Send / Stop Button */}
          {isStreaming ? (
            <button
              type="button"
              onClick={stopStreaming}
              title={t.chat.stop}
              className="p-1.5 rounded-lg bg-red-600/90 hover:bg-red-500 text-white transition-colors cursor-pointer shrink-0 mb-0.5 shadow-sm"
            >
              <Square size={16} strokeWidth={2} />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!content.trim() && useChatStore.getState().attachments.length === 0}
              title={t.chat.send}
              className="p-1.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-900 disabled:opacity-30 disabled:hover:bg-zinc-100 transition-colors cursor-pointer shrink-0 mb-0.5 shadow-sm"
            >
              <ArrowUp size={16} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
