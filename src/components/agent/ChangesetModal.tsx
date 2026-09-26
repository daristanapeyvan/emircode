import React, { useState } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';
import { AlertTriangle } from 'lucide-react';
import { DiffViewer } from '@/components/common/DiffViewer';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { cn } from '@/lib/utils/cn';

export const ChangesetModal: React.FC = () => {
  const { pendingChangeset, toggleChangesetItem, selectAllChangeset, approveSelectedChangeset, rejectChangeset } = useAgentStore();

  const { settings } = useSettingsStore();
  const t = getTranslations(settings.language);

  const [activeFileIndex, setActiveFileIndex] = useState(0);

  if (pendingChangeset.length === 0) return null;

  const currentItem = pendingChangeset[activeFileIndex] || pendingChangeset[0];
  const selectedCount = pendingChangeset.filter((i) => i.selected).length;

  return (
    <Modal
      isOpen
      onClose={rejectChangeset}
      dismissible={false}
      title={t.agent.changesetTitle}
      width="max-w-5xl"
      bodyClassName="flex min-h-[420px]"
      footer={
        <>
          {selectedCount === 0 && <span className="text-xs text-zinc-500">{t.agent.mustSelectAtLeastOneFile}</span>}
          <span className="flex-1" />
          <Button variant="secondary" onClick={rejectChangeset}>
            {t.agent.rejectAll}
          </Button>
          <Button variant="primary" disabled={selectedCount === 0} onClick={approveSelectedChangeset}>
            {t.agent.applyCount.replace('{count}', String(selectedCount))}
          </Button>
        </>
      }
    >
      {/* Files */}
      <div className="w-64 border-r border-zinc-800 p-2 overflow-y-auto shrink-0">
        <div className="flex items-center justify-end gap-3 px-1.5 pb-2 text-xs text-zinc-500">
          <button type="button" onClick={() => selectAllChangeset(true)} className="hover:text-zinc-200 cursor-pointer">
            {t.agent.selectAll}
          </button>
          <button type="button" onClick={() => selectAllChangeset(false)} className="hover:text-zinc-200 cursor-pointer">
            {t.agent.clearSelection}
          </button>
        </div>

        <div className="space-y-0.5">
          {pendingChangeset.map((item, idx) => (
            <div
              key={item.id}
              onClick={() => setActiveFileIndex(idx)}
              className={cn(
                'flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer transition-colors',
                idx === activeFileIndex ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/50'
              )}
            >
              <input
                type="checkbox"
                checked={item.selected}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggleChangesetItem(item.id)}
                className="accent-accent cursor-pointer"
              />
              <span className="truncate font-mono flex-1">{item.relativePath}</span>
              {item.operation === 'create' && <span className="text-[11px] text-zinc-500 shrink-0">{t.agent.newFile}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* The selected file */}
      <div className="flex-1 min-w-0 p-4 overflow-y-auto flex flex-col gap-3">
        <div className="space-y-1">
          <p className="text-xs font-mono text-zinc-200 break-all">{currentItem.relativePath}</p>
          {currentItem.reason && <p className="text-xs text-zinc-400 leading-relaxed">{currentItem.reason}</p>}
        </div>

        {currentItem.error && (
          <p className="flex items-start gap-2 text-xs text-red-400">
            <AlertTriangle size={14} className="shrink-0 mt-px" />
            {currentItem.error}
          </p>
        )}

        <div className="flex-1 min-h-[300px]">
          <DiffViewer
            originalContent={currentItem.originalContent || ''}
            newContent={currentItem.newContent || ''}
            language={currentItem.relativePath.split('.').pop() || 'text'}
          />
        </div>
      </div>
    </Modal>
  );
};
