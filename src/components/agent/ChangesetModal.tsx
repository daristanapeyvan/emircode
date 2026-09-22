import React, { useState } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { Check, X, ShieldAlert, FileEdit, PlusCircle, AlertTriangle } from 'lucide-react';
import { DiffViewer } from '@/components/common/DiffViewer';

export const ChangesetModal: React.FC = () => {
  const {
    pendingChangeset,
    toggleChangesetItem,
    selectAllChangeset,
    approveSelectedChangeset,
    rejectChangeset,
  } = useAgentStore();

  const [activeFileIndex, setActiveFileIndex] = useState(0);

  if (pendingChangeset.length === 0) return null;

  const currentItem = pendingChangeset[activeFileIndex] || pendingChangeset[0];
  const selectedCount = pendingChangeset.filter((i) => i.selected).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-zinc-900 border border-zinc-700/80 rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/60">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <FileEdit size={16} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                Önerilen Kod Değişiklikleri (Changeset Review)
                <span className="text-xs px-2 py-0.5 bg-blue-600/20 text-blue-400 rounded-full border border-blue-500/30">
                  {selectedCount}/{pendingChangeset.length} Dosya Seçili
                </span>
              </h2>
              <p className="text-xs text-zinc-400">
                Diske yazılmadan önce her dosya SHA-256 hash ve Realpath sandbox kontrolünden geçirilir.
              </p>
            </div>
          </div>

          <button
            onClick={rejectChangeset}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-md transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content Body: Sidebar list + Active Diff Viewer */}
        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* File Selector Panel */}
          <div className="w-72 border-r border-zinc-800/80 p-3 overflow-y-auto bg-zinc-950/30 flex flex-col justify-between shrink-0">
            <div>
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-zinc-800 text-xs text-zinc-400">
                <span>Değişecek Dosyalar</span>
                <div className="flex gap-2 text-xs">
                  <button
                    onClick={() => selectAllChangeset(true)}
                    className="hover:text-blue-400 cursor-pointer"
                  >
                    Tümünü Seç
                  </button>
                  <button
                    onClick={() => selectAllChangeset(false)}
                    className="hover:text-zinc-200 cursor-pointer"
                  >
                    Temizle
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                {pendingChangeset.map((item, idx) => {
                  const isActive = idx === activeFileIndex;
                  return (
                    <div
                      key={item.id}
                      onClick={() => setActiveFileIndex(idx)}
                      className={`flex items-center gap-2 p-2 rounded-md text-xs cursor-pointer transition-colors ${
                        isActive
                          ? 'bg-zinc-800 text-white font-medium'
                          : 'hover:bg-zinc-800/50 text-zinc-400'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={item.selected}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggleChangesetItem(item.id);
                        }}
                        className="rounded border-zinc-700 bg-zinc-800 text-blue-600 focus:ring-0 cursor-pointer"
                      />
                      {item.operation === 'create' ? (
                        <PlusCircle size={13} className="text-emerald-400 shrink-0" />
                      ) : (
                        <FileEdit size={13} className="text-blue-400 shrink-0" />
                      )}
                      <span className="truncate font-mono">{item.relativePath}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Sandbox Security Badge */}
            <div className="mt-4 p-2 rounded bg-blue-950/30 border border-blue-900/40 text-[11px] text-blue-300 flex items-center gap-1.5">
              <ShieldAlert size={14} className="shrink-0 text-blue-400" />
              <span>Tek kullanımlık token ve atomik kayıt devrede.</span>
            </div>
          </div>

          {/* Diff Preview Panel */}
          <div className="flex-1 p-4 overflow-y-auto flex flex-col gap-3 min-w-0">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-mono font-semibold text-zinc-200">
                  {currentItem.relativePath}
                </span>
                <p className="text-xs text-zinc-400 mt-0.5">
                  <span className="font-semibold text-zinc-300">Gerekçe:</span> {currentItem.reason}
                </p>
              </div>

              <span className="text-xs text-zinc-500 font-mono">
                Base Hash: {currentItem.baseHash ? currentItem.baseHash.slice(0, 8) + '...' : '(Yeni)'}
              </span>
            </div>

            {currentItem.error && (
              <div className="p-2.5 rounded bg-red-950/40 border border-red-800/60 text-xs text-red-300 flex items-center gap-2">
                <AlertTriangle size={15} className="text-red-400 shrink-0" />
                <span>{currentItem.error}</span>
              </div>
            )}

            {/* Rich Diff Viewer */}
            <div className="flex-1 overflow-hidden min-h-[300px]">
              <DiffViewer
                originalContent={currentItem.originalContent || ''}
                newContent={currentItem.newContent || ''}
                filePath={currentItem.relativePath}
              />
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3 border-t border-zinc-800 bg-zinc-950/80 flex items-center justify-between">
          <span className="text-xs text-zinc-400">
            {selectedCount === 0
              ? 'En az bir dosya seçmelisiniz.'
              : `${selectedCount} dosya için onay verilecek.`}
          </span>

          <div className="flex items-center gap-2">
            <button
              onClick={rejectChangeset}
              className="px-4 py-1.5 text-xs font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
            >
              Tümünü Reddet
            </button>
            <button
              disabled={selectedCount === 0}
              onClick={approveSelectedChangeset}
              className="px-4 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-sm flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Check size={14} />
              Seçilenleri Uygula ({selectedCount})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
