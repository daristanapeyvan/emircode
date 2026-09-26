import React from 'react';
import { Select } from '@/components/common/Select';
import { SettingsRow } from './SettingsRow';
import { Toggle } from '@/components/common/Toggle';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';
import { DEFAULT_SETTINGS, DesignThemeMode, DesignBaseCssMode } from '@/types/settings';
import { THEMES, DESIGN_CATEGORIES, getTheme } from '@/lib/design/themes';

/** The theme applied to web pages the agent creates. */
export const DesignSettings: React.FC = () => {
  const { settings, setDesignTheme } = useSettingsStore();
  const t = getTranslations(settings.language);
  const design = settings.designTheme || DEFAULT_SETTINGS.designTheme;
  const fixedTheme = getTheme(design.fixedThemeId) || THEMES[0];

  return (
    <div>
      <SettingsRow label={t.settings.designMode} description={t.settings.designModeDesc}>
        <Select
          ariaLabel={t.settings.designMode}
          value={design.mode}
          onChange={(v) => setDesignTheme({ mode: v as DesignThemeMode })}
          options={[
            { value: 'topic', label: t.settings.designModeTopic },
            { value: 'random', label: t.settings.designModeRandom },
            { value: 'fixed', label: t.settings.designModeFixed },
            { value: 'off', label: t.settings.designModeOff },
          ]}
        />
      </SettingsRow>

      {design.mode === 'fixed' && (
        <SettingsRow label={t.settings.designFixedTheme} description={`${fixedTheme.fonts.heading.family || '—'} / ${fixedTheme.fonts.body.family || '—'} · ${fixedTheme.mood}`}>
          <span className="flex mr-2 rounded-sm overflow-hidden border border-zinc-700" aria-hidden="true">
            {[fixedTheme.colors.bg, fixedTheme.colors.surface2, fixedTheme.colors.inverse, fixedTheme.colors.accent, fixedTheme.colors.accent2].map((color, i) => (
              <i key={i} className="block w-2.5 h-4" style={{ backgroundColor: color }} />
            ))}
          </span>
          <Select
            ariaLabel={t.settings.designFixedTheme}
            value={fixedTheme.id}
            onChange={(v) => setDesignTheme({ fixedThemeId: v })}
            options={DESIGN_CATEGORIES.map((cat) => ({
              label: cat.label,
              options: THEMES.filter((th) => th.category === cat.id).map((th) => ({
                value: th.id,
                label: `${th.name}${th.mode === 'dark' ? t.settings.designDarkSuffix : ''}`,
              })),
            }))}
          />
        </SettingsRow>
      )}

      <SettingsRow label={t.settings.designBaseCss} description={t.settings.designBaseCssDesc}>
        <Select
          ariaLabel={t.settings.designBaseCss}
          value={design.baseCss}
          onChange={(v) => setDesignTheme({ baseCss: v as DesignBaseCssMode })}
          options={[
            { value: 'auto', label: t.settings.designBaseAuto },
            { value: 'on', label: t.settings.designBaseOn },
            { value: 'off', label: t.settings.designBaseOff },
          ]}
        />
      </SettingsRow>

      <SettingsRow label={t.settings.designWebFonts} description={t.settings.designWebFontsDesc}>
        <Toggle checked={design.webFonts} onChange={(checked) => setDesignTheme({ webFonts: checked })} />
      </SettingsRow>
    </div>
  );
};
