import React from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSiteWizardStore } from '@/stores/siteWizardStore';
import { useToolWizardStore } from '@/stores/toolWizardStore';
import { getTranslations } from '@/lib/localization/i18n';
import { WebsiteIcon } from './wizard/WebsiteIcon';
import { MiniAppIcon, ScriptIcon } from './wizard/ToolIcons';

interface Suggestion {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  onSelect: () => void;
}

/**
 * Starting points for people who want to create something new, shown above the composer of an
 * empty session in an empty (or not yet chosen) folder. Typing a request into the composer keeps
 * working exactly as before.
 */
export const SuggestionChips: React.FC = () => {
  const language = useSettingsStore((s) => s.settings.language);
  const openSiteWizard = useSiteWizardStore((s) => s.openWizard);
  const openToolWizard = useToolWizardStore((s) => s.openWizard);
  const tr = getTranslations(language);
  const w = tr.wizard;
  const t = tr.toolWizard;

  const suggestions: Suggestion[] = [
    { id: 'website', icon: <WebsiteIcon size={17} />, title: w.chipTitle, description: w.chipDesc, onSelect: openSiteWizard },
    { id: 'mini', icon: <MiniAppIcon size={17} />, title: t.miniChipTitle, description: t.miniChipDesc, onSelect: () => openToolWizard('mini') },
    { id: 'script', icon: <ScriptIcon size={17} />, title: t.scriptChipTitle, description: t.scriptChipDesc, onSelect: () => openToolWizard('script') },
  ];

  return (
    <div className="max-w-3xl mx-auto mb-2.5 grid gap-2 grid-cols-[repeat(auto-fit,minmax(190px,1fr))] animate-in fade-in duration-200" role="list">
      {suggestions.map((s) => (
        <button
          key={s.id}
          type="button"
          role="listitem"
          onClick={s.onSelect}
          className="group flex items-center gap-3 px-3 py-2 rounded-lg border border-zinc-800/60 bg-zinc-900/70 hover:bg-zinc-800/60 hover:border-zinc-700 text-left transition-colors cursor-pointer min-w-0"
        >
          <span className="text-zinc-400 group-hover:text-zinc-200 shrink-0 transition-colors">{s.icon}</span>
          <span className="flex flex-col min-w-0">
            <span className="text-[13px] font-medium text-zinc-100 leading-tight">{s.title}</span>
            <span className="text-[11px] text-zinc-500 leading-snug mt-0.5 line-clamp-2">{s.description}</span>
          </span>
        </button>
      ))}
    </div>
  );
};
