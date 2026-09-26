import React, { useState, useEffect } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUIStore } from '@/stores/uiStore';
import { storageService } from '@/lib/storage/StorageService';
import { getTranslations } from '@/lib/localization/i18n';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { textareaClass } from '../agent/wizard/wizardUi';

/** The open chat's system instructions (with the saved presets one click away). */
export const SystemPromptPopover: React.FC = () => {
  const { isSystemPromptOpen, setSystemPromptOpen } = useUIStore();
  const { activeChatId, updateChatSystemPrompt } = useChatStore();
  const { settings } = useSettingsStore();
  const t = getTranslations(settings.language);

  const [prompt, setPrompt] = useState('');
  const presets = storageService.getData().systemPrompts || [];

  useEffect(() => {
    if (activeChatId) {
      const chat = storageService.getChat(activeChatId);
      setPrompt(chat?.systemPrompt || '');
    }
  }, [activeChatId, isSystemPromptOpen]);

  if (!activeChatId) return null;

  const close = () => setSystemPromptOpen(false);
  const handleSave = () => {
    updateChatSystemPrompt(activeChatId, prompt);
    close();
  };

  return (
    <Modal
      isOpen={isSystemPromptOpen}
      onClose={close}
      title={t.chat.systemInstructions}
      width="max-w-lg"
      footer={
        <>
          <span className="flex-1" />
          <Button variant="secondary" onClick={close}>
            {t.common.cancel}
          </Button>
          <Button variant="primary" onClick={handleSave}>
            {t.common.save}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {presets.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <Button key={p.id} variant="secondary" size="sm" onClick={() => setPrompt(p.content)}>
                {t.chat.systemPromptNames[p.id] || p.name}
              </Button>
            ))}
          </div>
        )}
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t.chat.systemPromptPlaceholder}
          rows={6}
          autoFocus
          className={textareaClass}
        />
      </div>
    </Modal>
  );
};
