import React from 'react';
import { X, FileText, Image as ImageIcon } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { formatBytes } from '@/lib/utils/formatters';

export const AttachmentTray: React.FC = () => {
  const { attachments, removeAttachment } = useChatStore();

  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-3 pt-2 pb-1 bg-zinc-900/60 border-b border-zinc-800/80">
      {attachments.map((att) => (
        <div
          key={att.id}
          className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-800 border border-zinc-700/60 text-xs text-zinc-300 group"
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

          <span className="font-mono text-[11px] truncate max-w-[120px]">{att.name}</span>
          <span className="text-[10px] text-zinc-500 font-mono">({formatBytes(att.size)})</span>

          <button
            type="button"
            onClick={() => removeAttachment(att.id)}
            className="p-0.5 text-zinc-500 hover:text-zinc-200 rounded transition-colors cursor-pointer ml-0.5"
            title="Remove attachment"
          >
            <X size={12} strokeWidth={1.5} />
          </button>
        </div>
      ))}
    </div>
  );
};
