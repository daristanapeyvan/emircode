import React from 'react';
import { Download, Upload, Trash2, FileText, Code, Database } from 'lucide-react';
import { SettingsRow } from './SettingsRow';
import { Button } from '../common/Button';
import { confirmDialog, noticeDialog } from '@/lib/ui/dialogs';
import { storageService } from '@/lib/storage/StorageService';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';

export const StorageSettings: React.FC = () => {
  const { activeChatId, init: reloadChats } = useChatStore();
  const { settings } = useSettingsStore();
  const t = getTranslations(settings.language);

  const handleExportChat = async (format: 'md' | 'txt' | 'json') => {
    if (!activeChatId) return;

    let content = '';
    let ext = format;
    if (format === 'md') {
      content = storageService.exportChatMarkdown(activeChatId);
    } else if (format === 'txt') {
      content = storageService.exportChatTxt(activeChatId);
    } else {
      content = storageService.exportChatJson(activeChatId);
    }

    if (window.electronAPI?.saveFileDialog) {
      await window.electronAPI.saveFileDialog({
        title: t.settings.exportChat,
        defaultPath: `conversation_${Date.now()}.${ext}`,
        filters: [{ name: format.toUpperCase(), extensions: [ext] }],
        content,
      });
    } else {
      // Browser download fallback
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `conversation_${Date.now()}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleExportAll = async () => {
    const backupJson = storageService.exportAllBackup();
    if (window.electronAPI?.saveFileDialog) {
      await window.electronAPI.saveFileDialog({
        title: t.settings.exportAll,
        defaultPath: `emir_code_backup_${Date.now()}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
        content: backupJson,
      });
    } else {
      const blob = new Blob([backupJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `emir_code_backup_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleImport = async () => {
    if (window.electronAPI?.openFileDialog) {
      const res = await window.electronAPI.openFileDialog({
        title: t.settings.importData,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (res.success && res.files && res.files.length > 0) {
        const file = res.files[0];
        const ok = storageService.importAllBackup(file.content);
        if (ok) {
          await reloadChats();
          void noticeDialog({ title: t.settings.importData, message: t.settings.importDone });
        } else {
          void noticeDialog({ title: t.settings.importData, message: t.settings.importFailed });
        }
      }
    }
  };

  const handleClearAll = async () => {
    if (await confirmDialog({ title: t.settings.clearAllChats, message: t.settings.clearAllConfirm, confirmLabel: t.common.delete, danger: true })) {
      storageService.clearAllData();
      reloadChats();
    }
  };

  return (
    <div>
      {/* Export active conversation */}
      <SettingsRow
        label={t.settings.exportChat}
        description={t.settings.exportChatDesc}
      >
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            icon={<FileText size={12} strokeWidth={1.5} />}
            onClick={() => handleExportChat('md')}
            disabled={!activeChatId}
          >
            Markdown
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={<FileText size={12} strokeWidth={1.5} />}
            onClick={() => handleExportChat('txt')}
            disabled={!activeChatId}
          >
            TXT
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={<Code size={12} strokeWidth={1.5} />}
            onClick={() => handleExportChat('json')}
            disabled={!activeChatId}
          >
            JSON
          </Button>
        </div>
      </SettingsRow>

      {/* Backup and Restore */}
      <SettingsRow
        label={t.settings.exportAll}
        description={t.settings.exportAllDesc}
      >
        <Button
          size="sm"
          variant="secondary"
          icon={<Download size={13} strokeWidth={1.5} />}
          onClick={handleExportAll}
        >
          {t.common.download}
        </Button>
      </SettingsRow>

      <SettingsRow
        label={t.settings.importData}
        description={t.settings.importDataDesc}
      >
        <Button
          size="sm"
          variant="secondary"
          icon={<Upload size={13} strokeWidth={1.5} />}
          onClick={handleImport}
        >
          {t.settings.importButton}
        </Button>
      </SettingsRow>

      {/* Clear Data */}
      <SettingsRow
        label={t.settings.clearAllChats}
        description={t.settings.clearAllChatsDesc}
      >
        <Button
          size="sm"
          variant="danger"
          icon={<Trash2 size={13} strokeWidth={1.5} />}
          onClick={handleClearAll}
        >
          {t.common.clear}
        </Button>
      </SettingsRow>
    </div>
  );
};
