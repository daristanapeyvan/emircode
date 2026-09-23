import React from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';
import { Terminal, ShieldCheck, X, Play } from 'lucide-react';

export const CommandApprovalModal: React.FC = () => {
  const { pendingCommand, approveCommand, rejectCommand } = useAgentStore();
  const { settings } = useSettingsStore();
  const t = getTranslations(settings.language);

  if (!pendingCommand) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-zinc-900 border border-zinc-700/80 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-zinc-800 bg-zinc-950/60 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Terminal size={16} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">
                {t.agent.commandApprovalTitle}
              </h2>
              <p className="text-xs text-zinc-400">
                {t.agent.commandApprovalDesc}
              </p>
            </div>
          </div>
          <button
            onClick={rejectCommand}
            className="text-zinc-400 hover:text-white p-1 rounded hover:bg-zinc-800 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-3.5 text-xs">
          <div>
            <span className="text-zinc-400 block mb-1.5 font-medium">{t.agent.commandToRun}</span>
            <div className="p-3 bg-zinc-950 rounded border border-zinc-800 font-mono text-amber-300 select-text flex items-center gap-2">
              <span className="text-zinc-500 select-none">$</span>
              <span>{pendingCommand.binary} {pendingCommand.args.join(' ')}</span>
            </div>
          </div>

          <div className="p-3 bg-zinc-800/40 border border-zinc-700/50 rounded">
            <span className="text-zinc-400 font-medium block mb-1">{t.agent.agentReasoning}</span>
            <span className="text-zinc-200">{pendingCommand.reason}</span>
          </div>

          <div className="p-2.5 rounded bg-emerald-950/30 border border-emerald-900/40 text-[11px] text-emerald-300 flex items-center gap-2">
            <ShieldCheck size={16} className="text-emerald-400 shrink-0" />
            <span>
              {t.agent.processIsolationNotice}
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-zinc-950/80 border-t border-zinc-800 flex items-center justify-end gap-2">
          <button
            onClick={rejectCommand}
            className="px-4 py-1.5 text-xs font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
          >
            {t.agent.reject}
          </button>
          <button
            onClick={approveCommand}
            className="px-4 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-500 rounded-lg shadow-sm flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Play size={13} className="fill-white" />
            {t.agent.allowAndRun}
          </button>
        </div>
      </div>
    </div>
  );
};
