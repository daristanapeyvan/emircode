import React, { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useSiteWizardStore } from '@/stores/siteWizardStore';
import { useAgentStore } from '@/stores/agentStore';
import { compileSitePrompt, pageFiles, FEATURE_KEYS } from '@/lib/wizard/siteWizard';
import { getTheme } from '@/lib/design/themes';
import { WorkspaceFileInfo } from '../../../../electron/preload';
import { StepHeader, SettingRow, fill } from './wizardUi';
import { Button } from '@/components/common/Button';
import { sectionLabel } from './StepStructure';
import type { WizardText } from './SiteWizard';

export function countFiles(items: WorkspaceFileInfo[]): number {
  let n = 0;
  for (const item of items) {
    if (item.isDirectory) n += countFiles(item.children || []);
    else n++;
  }
  return n;
}

const Card: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="rounded-md border border-zinc-800/80 bg-zinc-900 p-3.5">
    <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">{title}</p>
    <div className="text-[13px] text-zinc-200 space-y-1">{children}</div>
  </div>
);

export const StepSummary: React.FC<{ w: WizardText; lang: 'tr' | 'en' }> = ({ w, lang }) => {
  const data = useSiteWizardStore((s) => s.data);
  const { workspaceRoot, workspaceName, workspaceFiles, agentStatus, openWorkspaceDialog } = useAgentStore();
  const compiled = useMemo(() => compileSitePrompt(data), [data]);
  const fileCount = countFiles(workspaceFiles || []);
  const files = pageFiles(data.pages);
  const theme = compiled.design.enabled && compiled.design.themeId ? getTheme(compiled.design.themeId) : undefined;
  const busy = agentStatus !== 'idle' && agentStatus !== 'finished' && agentStatus !== 'error';
  const featureNames = FEATURE_KEYS.filter((k) => data.features[k]).map((k) => {
    const key = `feature${k[0].toUpperCase()}${k.slice(1)}` as keyof WizardText;
    return w[key] as string;
  });

  return (
    <div className="space-y-5">
      <StepHeader title={w.stepSummary} description={w.stepSummaryDesc} />

      <div className="grid gap-3 md:grid-cols-2">
        <Card title={w.summarySite}>
          <p className="font-medium text-zinc-100">{data.siteName.trim() || '—'}</p>
          <p className="text-zinc-400 text-xs">
            {[data.siteType.trim(), w.categories[compiled.category], data.language === 'en' ? 'English' : 'Türkçe'].filter(Boolean).join(' · ')}
          </p>
          {data.description.trim() && <p className="text-zinc-500 text-xs line-clamp-2">{data.description.trim()}</p>}
        </Card>
        <Card title={w.summaryDesign}>
          {!compiled.design.enabled ? (
            <p>{w.themeNone}</p>
          ) : theme ? (
            <div className="flex items-center gap-2.5">
              <span className="flex rounded overflow-hidden border border-zinc-700 shrink-0" aria-hidden="true">
                {[theme.colors.bg, theme.colors.inverse, theme.colors.accent, theme.colors.accent2].map((c, i) => (
                  <i key={i} className="block w-3.5 h-5" style={{ backgroundColor: c }} />
                ))}
              </span>
              <span>
                <span className="block">{theme.name}</span>
                <span className="block text-xs text-zinc-500">{theme.fonts.heading.family} / {theme.fonts.body.family}</span>
              </span>
            </div>
          ) : (
            <p>
              {w.themeAuto} · {w.categories[compiled.category]}
              {data.colorMode !== 'auto' && ` · ${data.colorMode === 'dark' ? w.colorModeDark : w.colorModeLight}`}
            </p>
          )}
        </Card>
        <Card title={w.summaryStructure}>
          <p className="text-xs text-zinc-400">
            {fill(w.pagesCount, { count: compiled.stats.pages })} · {fill(w.sectionsCount, { count: compiled.stats.sections })}
          </p>
          <ul className="space-y-0.5">
            {data.pages.map((p, i) => (
              <li key={p.id} className="text-xs text-zinc-300 truncate">
                <span className="font-mono text-zinc-500">{files[i]}</span> — {p.sections.map((s) => s.title.trim() || sectionLabel(s.kind, lang)).join(', ') || '—'}
              </li>
            ))}
          </ul>
        </Card>
        <Card title={`${w.summaryContent} · ${w.summaryFeatures}`}>
          <p className="text-xs">{compiled.stats.userTexts > 0 ? fill(w.summaryUserTexts, { count: compiled.stats.userTexts }) : w.summaryAgentTexts}</p>
          <p className="text-xs text-zinc-400">{featureNames.length ? featureNames.join(', ') : w.summaryNone}</p>
        </Card>
      </div>

      {/* Project folder */}
      <div className="rounded-md border border-zinc-800/80 bg-zinc-900 px-3.5">
        <SettingRow label={w.folder} description={workspaceRoot ? undefined : w.folderNone}>
          {workspaceRoot && (
            <span className="text-xs font-mono text-zinc-300 truncate max-w-[260px]" title={workspaceRoot}>
              {workspaceName || workspaceRoot}
            </span>
          )}
          <Button variant="secondary" size="sm" onClick={() => openWorkspaceDialog()}>
            {workspaceRoot ? w.folderChange : w.folderChoose}
          </Button>
        </SettingRow>
      </div>
      {workspaceRoot && fileCount > 0 && (
        <p className="text-xs text-amber-300/90 flex items-start gap-2">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {fill(w.folderNotEmpty, { count: fileCount })}
        </p>
      )}

      {busy && (
        <p className="text-xs text-amber-300 flex items-center gap-2">
          <AlertTriangle size={14} /> {w.agentBusy}
        </p>
      )}
      {compiled.warnings.length > 0 && (
        <ul className="space-y-1">
          {compiled.warnings.map((warning) => (
            <li key={warning} className="text-xs text-amber-300/90 flex items-start gap-2">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {warning}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
