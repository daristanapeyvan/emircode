import React, { useState, useEffect } from 'react';
import { Sliders, Check, X } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUIStore } from '@/stores/uiStore';
import { storageService } from '@/lib/storage/StorageService';
import { getTranslations } from '@/lib/localization/i18n';
import { Button } from '../common/Button';

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

  if (!isSystemPromptOpen || !activeChatId) return null;

  const handleSave = () => {
    updateChatSystemPrompt(activeChatId, prompt);
    setSystemPromptOpen(false);
  };

  const handleApplyPreset = (content: string) => {
    setPrompt(content);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center pt-16 p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-[1px]"
        onClick={() => setSystemPromptOpen(false)}
      />

      {/* Popover Card */}
      <div className="relative w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl overflow-hidden z-10 text-xs">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-950/60">
          <div className="flex items-center gap-2 text-zinc-200 font-medium">
            <Sliders size={14} strokeWidth={1.5} />
            <span>{t.chat.systemInstructions}</span>
          </div>
          <button
            type="button"
            onClick={() => setSystemPromptOpen(false)}
            className="text-zinc-500 hover:text-zinc-300 cursor-pointer"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Preset Buttons */}
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleApplyPreset(p.content)}
                className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700/80 text-zinc-300 text-[11px] transition-colors cursor-pointer border border-zinc-700/50"
              >
                {p.name}
              </button>
            ))}
          </div>

          {/* Prompt Textarea */}
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Enter custom instructions to steer the model's behavior..."
            rows={5}
            className="w-full p-2.5 bg-zinc-950/60 border border-zinc-800 rounded text-zinc-200 focus:outline-none focus:border-blue-500 resize-y leading-relaxed font-sans selectable-text"
          />

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSystemPromptOpen(false)}
            >
              {t.common.cancel}
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Check size={13} strokeWidth={1.5} />}
              onClick={handleSave}
            >
              {t.common.save}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
