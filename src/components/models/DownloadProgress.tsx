import React from 'react';
import { X, ArrowDown } from 'lucide-react';
import { useModelStore } from '@/stores/modelStore';
import { formatBytes } from '@/lib/utils/formatters';

export const DownloadProgress: React.FC = () => {
  const { downloads, cancelPull } = useModelStore();
  const downloadList = Object.values(downloads);

  if (downloadList.length === 0) return null;

  return (
    <div className="fixed bottom-20 right-6 z-40 w-80 bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl p-3.5 space-y-3 select-none text-xs">
      <div className="flex items-center gap-2 text-zinc-200 font-medium pb-2 border-b border-zinc-800">
        <ArrowDown size={14} className="text-blue-400 animate-bounce" strokeWidth={1.5} />
        <span>Active Downloads ({downloadList.length})</span>
      </div>

      <div className="space-y-3">
        {downloadList.map((dl) => (
          <div key={dl.name} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-mono font-medium text-zinc-100 truncate mr-2">
                {dl.name}
              </span>
              <button
                type="button"
                onClick={() => cancelPull(dl.name)}
                className="text-zinc-500 hover:text-zinc-300 p-0.5 cursor-pointer"
                title="Cancel download"
              >
                <X size={13} strokeWidth={1.5} />
              </button>
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-blue-600 h-full transition-all duration-200 rounded-full"
                style={{ width: `${dl.percentage}%` }}
              />
            </div>

            {/* Stats */}
            <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono">
              <span>{dl.status}</span>
              <span>
                {dl.total > 0
                  ? `${formatBytes(dl.completed)} / ${formatBytes(dl.total)} (${dl.percentage}%)`
                  : formatBytes(dl.completed)}
              </span>
            </div>

            {dl.speed && (
              <div className="text-[10px] text-zinc-500 font-mono text-right">
                {dl.speed}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
