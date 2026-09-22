import React from 'react';
import { Download, Upload, Trash2, FileText, Code, Database } from 'lucide-react';
import { SettingsRow } from './SettingsRow';
import { Button } from '../common/Button';
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
        title: 'Export Conversation',
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
        title: 'Export All Local LLM Data',
        defaultPath: `local_llm_backup_${Date.now()}.json`,
        filters: [{ name: 'JSON Backup', extensions: ['json'] }],
        content: backupJson,
      });
    } else {
      const blob = new Blob([backupJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `local_llm_backup_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleImport = async () => {
    if (window.electronAPI?.openFileDialog) {
      const res = await window.electronAPI.openFileDialog({
        title: 'Import Local LLM Backup',
        filters: [{ name: 'JSON Backup', extensions: ['json'] }],
      });
      if (res.success && res.files && res.files.length > 0) {
        const file = res.files[0];
        const ok = storageService.importAllBackup(file.content);
        if (ok) {
          await reloadChats();
          alert('Data backup restored successfully.');
        } else {
          alert('Failed to parse backup JSON.');
        }
      }
    }
  };

  const handleClearAll = () => {
    if (window.confirm('Are you sure you want to delete ALL chats? This cannot be undone.')) {
      storageService.clearAllData();
      reloadChats();
    }
  };

  return (
    <div className="space-y-1">
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
          Import
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
