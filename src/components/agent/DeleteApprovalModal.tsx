import React from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';
import { Trash2, AlertOctagon, X, Check } from 'lucide-react';

export const DeleteApprovalModal: React.FC = () => {
  const { pendingDelete, approveDelete, rejectDelete } = useAgentStore();
  const { settings } = useSettingsStore();
  const t = getTranslations(settings.language);

  if (!pendingDelete) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-zinc-900 border-2 border-red-500/80 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header with High-Risk Styling */}
        <div className="px-5 py-3.5 border-b border-red-900/50 bg-red-950/40 flex items-center justify-between">
          <div className="flex items-center gap-2 text-red-400 font-semibold text-sm">
            <AlertOctagon size={18} />
            <span>{t.agent.deleteApprovalTitle}</span>
          </div>
          <button
            onClick={rejectDelete}
            className="text-zinc-400 hover:text-white p-1 rounded hover:bg-zinc-800 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 text-xs">
          <p className="text-zinc-300">
            {t.agent.deleteWarning}
          </p>

          <div className="p-3 bg-zinc-950/80 border border-zinc-800 rounded font-mono text-zinc-100 flex items-center gap-2">
            <Trash2 size={16} className="text-red-400 shrink-0" />
            <span className="truncate">{pendingDelete.relativePath}</span>
          </div>

          <div className="p-3 bg-zinc-800/40 border border-zinc-700/50 rounded">
            <span className="text-zinc-400 font-medium block mb-1">{t.agent.agentReasoning}</span>
            <span className="text-zinc-200">{pendingDelete.reason}</span>
          </div>

          <div className="text-[11px] text-zinc-500">
            {t.agent.deleteSnapshotNotice}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-zinc-950/80 border-t border-zinc-800 flex items-center justify-end gap-2">
          <button
            onClick={rejectDelete}
            className="px-4 py-1.5 text-xs font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
          >
            {t.agent.reject}
          </button>
          <button
            onClick={approveDelete}
            className="px-4 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg shadow-sm flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Check size={14} />
            {t.agent.confirmDeletion}
          </button>
        </div>
      </div>
    </div>
  );
};
