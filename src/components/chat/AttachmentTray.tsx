import React from 'react';
import { X, FileText } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { formatBytes } from '@/lib/utils/formatters';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';

export const AttachmentTray: React.FC = () => {
  const { attachments, removeAttachment } = useChatStore();
  const t = getTranslations(useSettingsStore((s) => s.settings.language));

  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 p-2 border-b border-zinc-800">
      {attachments.map((att) => (
        <div
          key={att.id}
          className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-800 text-xs text-zinc-300 group"
        >
          {att.isImage ? (
            <div className="w-4 h-4 rounded overflow-hidden flex items-center justify-center bg-zinc-900">
              <img
                src={att.content.startsWith('data:') ? att.content : `data:image/png;base64,${att.content}`}
                alt={att.name}
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <FileText size={12} className="text-zinc-400" strokeWidth={1.5} />
          )}

          <span className="truncate max-w-[140px]">{att.name}</span>
          <span className="text-[11px] text-zinc-500">{formatBytes(att.size)}</span>

          <button
            type="button"
            onClick={() => removeAttachment(att.id)}
            className="p-0.5 text-zinc-500 hover:text-zinc-200 rounded transition-colors cursor-pointer ml-0.5"
            title={t.chat.removeAttachment}
            aria-label={t.chat.removeAttachment}
          >
            <X size={12} strokeWidth={1.5} />
          </button>
        </div>
      ))}
    </div>
  );
};
