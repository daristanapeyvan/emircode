import React, { useEffect, useMemo } from 'react';
import { Sparkles, Ban, Check } from 'lucide-react';
import { useSiteWizardStore } from '@/stores/siteWizardStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { THEMES, ThemeDefinition, themesInCategory } from '@/lib/design/themes';
import { googleFontsUrlFor } from '@/lib/design/themeCss';
import { resolveCategory } from '@/lib/wizard/siteWizard';
import { StepHeader, Segmented } from './wizardUi';
import { cn } from '@/lib/utils/cn';
import type { WizardText } from './SiteWizard';

const PREVIEW_FONTS_ID = 'emir-theme-preview-fonts';

/** Loads the heading fonts of all themes once, so the cards show the real type (online only). */
function usePreviewFonts(enabled: boolean) {
  useEffect(() => {
    if (!enabled || document.getElementById(PREVIEW_FONTS_ID)) return;
    const url = googleFontsUrlFor(THEMES.map((t) => t.fonts.heading));
    if (!url) return;
    const link = document.createElement('link');
    link.id = PREVIEW_FONTS_ID;
    link.rel = 'stylesheet';
    link.href = url;
    document.head.appendChild(link);
  }, [enabled]);
}

const headingFont = (t: ThemeDefinition) =>
  t.fonts.heading.family ? `"${t.fonts.heading.family}", ${t.fonts.heading.fallback}` : t.fonts.heading.fallback;

/** A miniature page in the theme: header band, headline, text lines, button and card. */
const ThemeMiniature: React.FC<{ theme: ThemeDefinition; name: string; heading: string }> = ({ theme, name, heading }) => {
  const c = theme.colors;
  return (
    <div className="rounded-lg overflow-hidden border select-none" style={{ backgroundColor: c.bg, borderColor: c.border }} aria-hidden="true">
      <div className="px-2.5 py-1.5 flex items-center justify-between" style={{ backgroundColor: c.inverse, color: c.onInverse }}>
        <span
          className="text-[10px] truncate max-w-[60%]"
          style={{ fontFamily: headingFont(theme), fontWeight: theme.type.headingWeight, letterSpacing: theme.type.headingTracking }}
        >
          {name}
        </span>
        <span className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <i key={i} className="block w-3 h-[3px] rounded-full" style={{ backgroundColor: c.onInverseSoft, opacity: 0.7 }} />
          ))}
        </span>
      </div>
      <div className="px-3 pt-2.5 pb-3 space-y-1.5">
        <div
          className="text-[17px] leading-tight truncate"
          style={{
            fontFamily: headingFont(theme),
            fontWeight: theme.type.headingWeight,
            letterSpacing: theme.type.headingTracking,
            textTransform: theme.type.headingCase,
            color: c.ink,
          }}
        >
          {heading}
        </div>
        <div className="h-[5px] w-4/5 rounded-full" style={{ backgroundColor: c.inkSoft, opacity: 0.35 }} />
        <div className="h-[5px] w-3/5 rounded-full" style={{ backgroundColor: c.inkSoft, opacity: 0.25 }} />
        <div className="flex items-center gap-2 pt-1.5">
          <span
            className="px-2.5 py-1 text-[9px] font-semibold whitespace-nowrap"
            style={{
              backgroundColor: c.accent,
              color: c.onAccent,
              borderRadius: Math.min(theme.shape.buttonRadius, 999),
              border: theme.style.button === 'hard' ? `1.5px solid ${c.ink}` : undefined,
              boxShadow: theme.style.button === 'hard' ? `2px 2px 0 ${theme.style.shadow === 'hard-accent2' ? c.accent2 : c.ink}` : undefined,
              textTransform: theme.style.button === 'solid' || theme.style.button === 'hard' ? 'none' : 'uppercase',
              letterSpacing: theme.style.button === 'solid' || theme.style.button === 'hard' ? 0 : '0.12em',
            }}
          >
            Buton
          </span>
          <span className="flex-1 h-5" style={{ backgroundColor: c.surface, border: `1px solid ${c.border}`, borderRadius: Math.min(theme.shape.radius, 10) }} />
          <span className="w-4 h-4 rounded-full" style={{ backgroundColor: c.accent2 }} />
        </div>
      </div>
    </div>
  );
};

export const StepDesign: React.FC<{ w: WizardText }> = ({ w }) => {
  const { data, update } = useSiteWizardStore();
  const webFonts = useSettingsStore((s) => s.settings.designTheme?.webFonts ?? true);
  usePreviewFonts(webFonts);

  const category = resolveCategory(data);
  const recommended = useMemo(() => themesInCategory(category), [category]);
  const others = useMemo(() => THEMES.filter((t) => t.category !== category), [category]);
  const siteName = data.siteName.trim() || 'Site';

  const themeCard = (theme: ThemeDefinition, isRecommended: boolean) => {
    const selected = data.theme === theme.id;
    return (
      <button
        key={theme.id}
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={() => update({ theme: theme.id })}
        className={cn(
          'text-left rounded-md border p-2.5 transition-colors cursor-pointer group',
          selected ? 'border-zinc-400 bg-zinc-800/60' : 'border-zinc-800 bg-zinc-900 hover:border-zinc-600'
        )}
      >
        <ThemeMiniature theme={theme} name={siteName} heading={w.previewHeading} />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[13px] font-medium text-zinc-100 truncate">{theme.name}</span>
          <span className="flex items-center gap-1 shrink-0">
            {isRecommended && <span className="text-[11px] text-zinc-500">{w.recommended}</span>}
            {theme.mode === 'dark' && <span className="text-[11px] text-zinc-500">{w.darkBadge}</span>}
            {selected && <Check size={13} className="text-zinc-100" />}
          </span>
        </div>
        <p className="text-[11px] text-zinc-500 mt-0.5 leading-snug line-clamp-2">{theme.mood}</p>
      </button>
    );
  };

  const specialCard = (value: 'auto' | 'none', title: string, desc: string, icon: React.ReactNode) => {
    const selected = data.theme === value;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={() => update({ theme: value })}
        className={cn(
          'text-left rounded-md border p-3 transition-colors cursor-pointer flex items-start gap-3',
          selected ? 'border-zinc-400 bg-zinc-800/60' : 'border-zinc-800 bg-zinc-900 hover:border-zinc-600'
        )}
      >
        <span className={cn('mt-0.5 shrink-0', selected ? 'text-zinc-100' : 'text-zinc-500')}>{icon}</span>
        <span className="min-w-0">
          <span className="block text-[13px] font-medium text-zinc-100">{title}</span>
          <span className="block text-[11px] text-zinc-500 mt-0.5">{desc}</span>
          {value === 'auto' && (
            <span className="flex gap-1 mt-2">
              {recommended.map((t) => (
                <span key={t.id} className="flex rounded overflow-hidden border border-zinc-700" title={t.name}>
                  {[t.colors.bg, t.colors.inverse, t.colors.accent].map((col, i) => (
                    <i key={i} className="block w-3 h-3" style={{ backgroundColor: col }} />
                  ))}
                </span>
              ))}
            </span>
          )}
        </span>
      </button>
    );
  };

  return (
    <div className="space-y-5">
      <StepHeader title={w.themeTitle} description={w.themeHint} />

      <div role="radiogroup" aria-label={w.themeTitle} className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          {specialCard('auto', w.themeAuto, `${w.themeAutoDesc} · ${w.categories[category]}`, <Sparkles size={16} />)}
          {specialCard('none', w.themeNone, w.themeNoneDesc, <Ban size={16} />)}
        </div>

        {(data.theme === 'auto' || data.theme === 'none') && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-400">{w.colorMode}</span>
            <Segmented
              size="sm"
              ariaLabel={w.colorMode}
              value={data.colorMode}
              onChange={(colorMode) => update({ colorMode })}
              options={[
                { value: 'auto', label: w.colorModeAuto },
                { value: 'light', label: w.colorModeLight },
                { value: 'dark', label: w.colorModeDark },
              ]}
            />
          </div>
        )}

        <div>
          <p className="text-xs font-medium text-zinc-400 mb-2">
            {w.recommended} · {w.categories[category]}
          </p>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">{recommended.map((t) => themeCard(t, true))}</div>
        </div>

        <div>
          <p className="text-xs font-medium text-zinc-400 mb-2">{w.otherThemes}</p>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">{others.map((t) => themeCard(t, false))}</div>
        </div>
      </div>
    </div>
  );
};
