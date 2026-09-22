import React from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';

export const KeyboardSettings: React.FC = () => {
  const { settings } = useSettingsStore();
  const t = getTranslations(settings.language);

  const shortcuts = [
    { label: t.settings.shortcutNewChat, keys: ['Ctrl', 'N'] },
    { label: t.settings.shortcutCommandPalette, keys: ['Ctrl', 'K'] },
    { label: t.settings.shortcutModelSelector, keys: ['Ctrl', 'Shift', 'M'] },
    { label: t.settings.shortcutSettings, keys: ['Ctrl', ','] },
    { label: t.settings.shortcutSend, keys: ['Enter'] },
    { label: t.settings.shortcutNewline, keys: ['Shift', 'Enter'] },
    { label: t.settings.shortcutEscape, keys: ['Esc'] },
  ];

  return (
    <div className="space-y-3">
      <div className="text-zinc-400 text-xs leading-relaxed">
        {t.settings.shortcutsTitle}
      </div>

      <div className="space-y-1.5 border border-zinc-800/40 rounded-lg p-3 bg-zinc-950/40">
        {shortcuts.map((sc) => (
          <div
            key={sc.label}
            className="flex items-center justify-between py-1.5 px-2 border-b border-zinc-800/40 last:border-b-0 text-xs"
          >
            <span className="text-zinc-300">{sc.label}</span>
            <div className="flex items-center gap-1 font-mono">
              {sc.keys.map((k) => (
                <kbd
                  key={k}
                  className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 text-[11px] font-medium shadow-sm"
                >
                  {k}
                </kbd>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
