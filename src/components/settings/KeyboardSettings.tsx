import React from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';

export const KeyboardSettings: React.FC = () => {
  const { settings } = useSettingsStore();
  const t = getTranslations(settings.language);

  const shortcuts = [
    { label: t.settings.shortcutNewChat, keys: ['Ctrl', 'N'] },
    { label: t.projects.shortcutNewProject, keys: ['Ctrl', 'Shift', 'N'] },
    { label: t.settings.shortcutCommandPalette, keys: ['Ctrl', 'K'] },
    { label: t.settings.shortcutModelSelector, keys: ['Ctrl', 'Shift', 'M'] },
    { label: t.settings.shortcutSettings, keys: ['Ctrl', ','] },
    // Follows the "Send on Enter" setting.
    { label: t.settings.shortcutSend, keys: settings.sendOnEnter ? ['Enter'] : ['Ctrl', 'Enter'] },
    { label: t.settings.shortcutNewline, keys: settings.sendOnEnter ? ['Shift', 'Enter'] : ['Enter'] },
    { label: t.settings.shortcutEscape, keys: ['Esc'] },
  ];

  return (
    <div>
      {shortcuts.map((sc) => (
        <div key={sc.label} className="flex items-center justify-between gap-4 py-3 border-b border-zinc-800/60 last:border-b-0 text-xs">
          <span className="text-zinc-200">{sc.label}</span>
          <span className="flex items-center gap-1 shrink-0">
            {sc.keys.map((k) => (
              <kbd key={k} className="min-w-[22px] px-1.5 py-0.5 rounded border border-zinc-700 bg-zinc-800 text-zinc-300 text-[11px] font-sans text-center">
                {k}
              </kbd>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
};
