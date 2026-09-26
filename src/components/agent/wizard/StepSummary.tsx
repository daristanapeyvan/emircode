import React, { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useSiteWizardStore } from '@/stores/siteWizardStore';
import { useAgentStore } from '@/stores/agentStore';
import { compileSitePrompt, pageFiles, FEATURE_KEYS } from '@/lib/wizard/siteWizard';
import { getTheme } from '@/lib/design/themes';
import { compactPath } from '@/lib/utils/projects';
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

/** One line of the summary: what it is on the left, the answer on the right. */
const Line: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-start justify-between gap-6 py-3 border-b border-zinc-800/60 text-xs">
    <span className="text-zinc-400 shrink-0">{label}</span>
    <div className="min-w-0 text-right text-zinc-200 space-y-0.5">{children}</div>
  </div>
);

export const StepSummary: React.FC<{ w: WizardText; lang: 'tr' | 'en' }> = ({ w, lang }) => {
  const data = useSiteWizardStore((s) => s.data);
  const { workspaceRoot, workspaceName, workspaceFiles, agentStatus, openWorkspaceDialog, pendingProject } = useAgentStore();
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

      <div>
        <Line label={w.summarySite}>
          <p className="text-zinc-100">{data.siteName.trim() || '—'}</p>
          <p className="text-zinc-500">
            {[data.siteType.trim(), w.categories[compiled.category], data.language === 'en' ? 'English' : 'Türkçe'].filter(Boolean).join(' · ')}
          </p>
        </Line>
        <Line label={w.summaryDesign}>
          {!compiled.design.enabled ? (
            <p>{w.themeNone}</p>
          ) : theme ? (
            <p className="flex items-center justify-end gap-2">
              <span className="flex rounded-sm overflow-hidden border border-zinc-700 shrink-0" aria-hidden="true">
                {[theme.colors.bg, theme.colors.inverse, theme.colors.accent, theme.colors.accent2].map((c, i) => (
                  <i key={i} className="block w-2.5 h-4" style={{ backgroundColor: c }} />
                ))}
              </span>
              {theme.name} <span className="text-zinc-500">· {theme.fonts.heading.family} / {theme.fonts.body.family}</span>
            </p>
          ) : (
            <p>
              {w.themeAuto} · {w.categories[compiled.category]}
              {data.colorMode !== 'auto' && ` · ${data.colorMode === 'dark' ? w.colorModeDark : w.colorModeLight}`}
            </p>
          )}
        </Line>
        <Line label={w.summaryStructure}>
          <p className="text-zinc-500">
            {fill(w.pagesCount, { count: compiled.stats.pages })} · {fill(w.sectionsCount, { count: compiled.stats.sections })}
          </p>
          {data.pages.map((p, i) => (
            <p key={p.id} className="truncate">
              <span className="font-mono text-zinc-500">{files[i]}</span> — {p.sections.map((s) => s.title.trim() || sectionLabel(s.kind, lang)).join(', ') || '—'}
            </p>
          ))}
        </Line>
        <Line label={w.summaryContent}>
          <p>{compiled.stats.userTexts > 0 ? fill(w.summaryUserTexts, { count: compiled.stats.userTexts }) : w.summaryAgentTexts}</p>
        </Line>
        <Line label={w.summaryFeatures}>
          <p>{featureNames.length ? featureNames.join(', ') : w.summaryNone}</p>
        </Line>
        {pendingProject ? (
          <SettingRow label={w.folder} description={w.folderNew}>
            <span className="text-xs font-mono text-zinc-300 truncate max-w-[320px]" title={pendingProject.target}>
              {compactPath(pendingProject.target, 3)}
            </span>
          </SettingRow>
        ) : (
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
        )}
      </div>
      {!pendingProject && workspaceRoot && fileCount > 0 && (
        <p className="text-xs text-amber-400/90 flex items-start gap-2">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {fill(w.folderNotEmpty, { count: fileCount })}
        </p>
      )}

      {busy && (
        <p className="text-xs text-amber-400/90 flex items-center gap-2">
          <AlertTriangle size={14} /> {w.agentBusy}
        </p>
      )}
      {compiled.warnings.length > 0 && (
        <ul className="space-y-1">
          {compiled.warnings.map((warning) => (
            <li key={warning} className="text-xs text-amber-400/90 flex items-start gap-2">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {warning}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
