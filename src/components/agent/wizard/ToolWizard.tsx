import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Select } from '@/components/common/Select';
import { X, Search, ChevronLeft, RotateCcw, ShieldCheck } from 'lucide-react';
import { useToolWizardStore, ToolKind } from '@/stores/toolWizardStore';
import { useAgentStore } from '@/stores/agentStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations, resolveLanguage } from '@/lib/localization/i18n';
import { MINI_APPS, MINI_APP_CATEGORIES, MiniAppDef, ToolCategory, CompiledTool, compileMiniAppPrompt } from '@/lib/wizard/miniApps';
import { SCRIPTS, SCRIPT_CATEGORIES, ScriptDef, compileScriptPrompt, renamePreview, scriptFileName, scriptLanguage } from '@/lib/wizard/scripts';
import { Lang, ParamValues, defaultValues, tx } from '@/lib/wizard/params';
import { DESIGN_CATEGORIES, THEMES, getTheme } from '@/lib/design/themes';
import { Toggle } from '@/components/common/Toggle';
import { Button } from '@/components/common/Button';
import { IconButton } from '@/components/common/IconButton';
import { DialogFrame } from '@/components/common/Modal';
import { ParamRows } from './ParamFields';
import { ToolIcon } from './ToolIcons';
import { Segmented, SettingRow, SectionTitle, inputClass, fill } from './wizardUi';
import { cn } from '@/lib/utils/cn';
import { compactPath } from '@/lib/utils/projects';

type AnyTool = MiniAppDef | ScriptDef;
type ToolText = ReturnType<typeof getTranslations>['toolWizard'];

/** Case- and accent-tolerant search text (Turkish İ/ı fold to i). */
const fold = (s: string) => s.toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * The mini app / script wizards: a catalog (categories on the left, tool cards), and for the
 * chosen tool a settings page of its own. "Onayla" puts the request into the composer.
 */
export const ToolWizard: React.FC = () => {
  const open = useToolWizardStore((s) => s.open);
  const wasOpen = useRef(false);
  useEffect(() => {
    // Closed without confirming: the New Project folder is not created.
    if (wasOpen.current && !open) useAgentStore.getState().setPendingProject(null);
    wasOpen.current = !!open;
  }, [open]);
  if (!open) return null;
  return <ToolWizardDialog kind={open} />;
};

const ToolWizardDialog: React.FC<{ kind: ToolKind }> = ({ kind }) => {
  const toolId = useToolWizardStore((s) => s.toolId);
  const closeWizard = useToolWizardStore((s) => s.closeWizard);
  const language = useSettingsStore((s) => s.settings.language);
  const t = getTranslations(language).toolWizard;
  const lang: Lang = resolveLanguage(language);
  const tools: AnyTool[] = kind === 'mini' ? MINI_APPS : SCRIPTS;
  const tool = tools.find((x) => x.id === toolId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) closeWizard();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeWizard]);

  return (
    <DialogFrame onBackdropClick={closeWizard} labelledBy="tool-wizard-title" lang={lang} className="max-w-4xl h-[min(85vh,680px)]">
      {tool ? <ToolPage kind={kind} tool={tool} t={t} lang={lang} /> : <CatalogPage kind={kind} t={t} lang={lang} />}
    </DialogFrame>
  );
};

/** Categories on the left, the tools of the category (or the search results) as cards. */
const CatalogPage: React.FC<{ kind: ToolKind; t: ToolText; lang: Lang }> = ({ kind, t, lang }) => {
  const { closeWizard, openTool, selectCategory } = useToolWizardStore();
  const categoryId = useToolWizardStore((s) => s[kind].categoryId);
  const [query, setQuery] = useState('');
  const categories: ToolCategory[] = kind === 'mini' ? MINI_APP_CATEGORIES : SCRIPT_CATEGORIES;
  const tools: AnyTool[] = kind === 'mini' ? MINI_APPS : SCRIPTS;
  const q = fold(query.trim());
  const visible = q
    ? tools.filter((x) => fold(`${x.title.tr} ${x.title.en} ${x.description.tr} ${x.description.en}`).includes(q))
    : tools.filter((x) => x.category === categoryId);

  return (
    <>
      <div className="flex items-center gap-3 px-5 py-3 border-b border-zinc-800/80">
        <h2 id="tool-wizard-title" className="text-sm font-semibold text-zinc-100 tracking-tight">
          {kind === 'mini' ? t.miniTitle : t.scriptTitle}
        </h2>
        <label className="relative ml-auto">
          <Search size={13} strokeWidth={1.5} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.search}
            aria-label={t.search}
            className={cn(inputClass, 'w-44 sm:w-56 pl-8')}
          />
        </label>
        <IconButton label={t.close} icon={<X size={16} strokeWidth={1.5} />} onClick={closeWizard} size="sm" />
      </div>

      <div className="flex-1 flex flex-col sm:flex-row min-h-0">
        <nav
          aria-label={t.categories}
          className="flex sm:flex-col gap-0.5 p-2 overflow-x-auto sm:overflow-y-auto shrink-0 sm:w-48 border-b sm:border-b-0 sm:border-r border-zinc-800/40 select-none"
        >
          {categories.map((c) => {
            const active = !q && c.id === categoryId;
            return (
              <button
                key={c.id}
                type="button"
                aria-current={active ? 'true' : undefined}
                onClick={() => {
                  setQuery('');
                  selectCategory(kind, c.id);
                }}
                className={cn(
                  'shrink-0 sm:w-full flex items-center gap-2.5 px-3 py-2 rounded text-xs transition-colors cursor-pointer text-left whitespace-nowrap',
                  active ? 'bg-zinc-800 text-zinc-100 font-medium' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
                )}
              >
                <span className={active ? 'text-zinc-200' : 'text-zinc-500'}>
                  <ToolIcon id={c.icon} size={14} />
                </span>
                <span>{tx(c.title, lang)}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-5">
          {visible.length === 0 ? (
            <p className="text-xs text-zinc-500 py-10 text-center">{t.noResults}</p>
          ) : (
            <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
              {visible.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => openTool(x.id)}
                  className="group text-left rounded-md border border-zinc-800/80 bg-zinc-900 hover:bg-zinc-800/50 hover:border-zinc-700 px-3.5 py-3 flex flex-col gap-2 transition-colors cursor-pointer"
                >
                  <ToolIcon id={x.icon} size={18} className="text-zinc-400 group-hover:text-zinc-200 transition-colors" />
                  <span className="text-[13px] font-medium text-zinc-100 leading-snug">{tx(x.title, lang)}</span>
                  <span className="text-xs text-zinc-500 leading-snug line-clamp-2">{tx(x.description, lang)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

/** The chosen tool's own page: its settings, the output settings and "Onayla". */
const ToolPage: React.FC<{ kind: ToolKind; tool: AnyTool; t: ToolText; lang: Lang }> = ({ kind, tool, t, lang }) => {
  const { closeWizard, showCatalog, setValue, resetValues, setName } = useToolWizardStore();
  const mini = useToolWizardStore((s) => s.mini);
  const script = useToolWizardStore((s) => s.script);
  const { agentStatus, workspaceRoot, openWorkspaceDialog, setWizardDraft, pendingProject } = useAgentStore();
  const projectTexts = getTranslations(lang).projects;
  const draft = kind === 'mini' ? mini : script;
  // A mini app's defaults (sample lists, texts) follow the app's own language.
  const appLang: Lang = mini.language ?? lang;
  const valueLang: Lang = kind === 'mini' ? appLang : lang;
  const stored = draft.values[tool.id];
  const values: ParamValues = useMemo(() => ({ ...defaultValues(tool.fields, valueLang), ...(stored || {}) }), [tool, stored, valueLang]);
  const name = draft.names[tool.id] || '';
  const busy = agentStatus !== 'idle' && agentStatus !== 'finished' && agentStatus !== 'error';

  const compile = (): CompiledTool =>
    kind === 'mini'
      ? compileMiniAppPrompt(tool as MiniAppDef, values, { title: name, language: appLang, theme: mini.theme })
      : compileScriptPrompt(tool as ScriptDef, values, { language: script.language, fileName: name, test: script.test, requestLanguage: lang });

  const confirm = async () => {
    if (busy) return;
    if (useAgentStore.getState().pendingProject) {
      if (!(await useAgentStore.getState().createPendingProject())) return;
    } else if (!useAgentStore.getState().workspaceRoot) {
      await openWorkspaceDialog();
      if (!useAgentStore.getState().workspaceRoot) return;
    }
    const compiled = compile();
    setWizardDraft({
      kind,
      toolId: tool.id,
      // The badge already names the wizard: drop the "Mini Uygulama:" style prefix.
      label: compiled.displayGoal.replace(/^[^:"]+:\s*/, ''),
      prompt: compiled.prompt,
      options: {
        displayGoal: compiled.displayGoal,
        checklist: compiled.checklist,
        design: compiled.design,
        contracts: compiled.contracts,
        seedFiles: compiled.seedFiles,
        scriptOutputs: compiled.scriptOutputs,
        applyFlag: compiled.applyFlag,
      },
    });
    closeWizard();
  };

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-zinc-800/80">
        <IconButton label={t.back} icon={<ChevronLeft size={16} strokeWidth={1.5} />} onClick={showCatalog} size="sm" />
        <ToolIcon id={tool.icon} size={16} className="text-zinc-400 shrink-0" />
        <h2 id="tool-wizard-title" className="text-sm font-semibold text-zinc-100 tracking-tight truncate">
          {tx(tool.title, lang)}
        </h2>
        <span className="ml-auto" />
        <IconButton label={t.close} icon={<X size={16} strokeWidth={1.5} />} onClick={closeWizard} size="sm" />
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <p className="text-xs text-zinc-400 pt-4">{tx(tool.description, lang)}</p>

        <SectionTitle
          action={
            stored && (
              <Button variant="ghost" size="sm" icon={<RotateCcw size={12} strokeWidth={1.5} />} onClick={() => resetValues(kind, tool.id)} title={t.resetDefaultsTitle}>
                {t.resetDefaults}
              </Button>
            )
          }
        >
          {t.settings}
        </SectionTitle>
        <ParamRows
          fields={tool.fields}
          values={values}
          lang={lang}
          valueLang={valueLang}
          idPrefix={`tool-${tool.id}`}
          listHint={t.listHint}
          onChange={(key, value) => setValue(kind, tool.id, key, value)}
        />

        {kind === 'script' && (tool as ScriptDef).preview === 'rename' && <RenameResult values={values} t={t} lang={lang} />}

        <SectionTitle>{t.output}</SectionTitle>
        {kind === 'mini' ? (
          <MiniOutput app={tool as MiniAppDef} name={name} t={t} lang={lang} appLang={appLang} onName={(v) => setName('mini', tool.id, v)} />
        ) : (
          <ScriptOutput script={tool as ScriptDef} name={name} t={t} lang={lang} onName={(v) => setName('script', tool.id, v)} />
        )}
      </div>

      <div className="flex items-center gap-2 px-5 py-3 border-t border-zinc-800/80">
        <p className={cn('flex-1 min-w-0 text-[11px] truncate', busy ? 'text-amber-400/90' : 'text-zinc-500')} title={pendingProject?.target}>
          {busy ? t.agentBusy : pendingProject ? fill(projectTexts.newFolderHint, { path: compactPath(pendingProject.target, 3) }) : !workspaceRoot ? t.needFolder : t.confirmHint}
        </p>
        <Button variant="secondary" size="md" onClick={showCatalog}>
          {t.back}
        </Button>
        <Button variant="primary" size="md" onClick={confirm} disabled={busy}>
          {t.confirm}
        </Button>
      </div>
    </>
  );
};

/** Mini app output: title, interface language and the design theme. */
const MiniOutput: React.FC<{ app: MiniAppDef; name: string; t: ToolText; lang: Lang; appLang: Lang; onName: (v: string) => void }> = ({
  app,
  name,
  t,
  lang,
  appLang,
  onName,
}) => {
  const { mini, updateMini } = useToolWizardStore();
  const categoryNames = getTranslations(lang).wizard.categories as Record<string, string>;
  const chosen = mini.theme !== 'auto' && mini.theme !== 'none' ? getTheme(mini.theme) : undefined;
  return (
    <div>
      <SettingRow label={t.appName} htmlFor="tool-app-name">
        <input
          id="tool-app-name"
          type="text"
          value={name}
          maxLength={60}
          placeholder={tx(app.title, appLang)}
          onChange={(e) => onName(e.target.value)}
          className={cn(inputClass, 'w-56')}
        />
      </SettingRow>
      <SettingRow label={t.appLanguage}>
        <Segmented
          size="sm"
          ariaLabel={t.appLanguage}
          value={appLang}
          onChange={(language) => updateMini({ language })}
          options={[
            { value: 'tr', label: 'Türkçe' },
            { value: 'en', label: 'English' },
          ]}
        />
      </SettingRow>
      <SettingRow label={t.theme} htmlFor="tool-app-theme">
        {chosen && (
          <span className="flex rounded-sm overflow-hidden border border-zinc-700" title={chosen.name} aria-hidden="true">
            {[chosen.colors.bg, chosen.colors.inverse, chosen.colors.accent].map((c, i) => (
              <i key={i} className="block w-2.5 h-4" style={{ backgroundColor: c }} />
            ))}
          </span>
        )}
        <Select
          id="tool-app-theme"
          ariaLabel={t.theme}
          className="w-56"
          value={chosen ? chosen.id : mini.theme === 'none' ? 'none' : 'auto'}
          onChange={(theme) => updateMini({ theme })}
          options={[
            { value: 'auto', label: fill(t.themeAuto, { category: categoryNames[app.designCategory] || app.designCategory }) },
            { value: 'none', label: t.themeNone },
            ...DESIGN_CATEGORIES.map((c) => ({
              label: categoryNames[c.id] || c.label,
              options: THEMES.filter((theme) => theme.category === c.id).map((theme) => ({
                value: theme.id,
                label: `${theme.name}${theme.mode === 'dark' ? ` (${t.dark})` : ''}`,
              })),
            })),
          ]}
        />
      </SettingRow>
    </div>
  );
};

/** Script output: language, file name, the sample-data test and the safety summary. */
const ScriptOutput: React.FC<{ script: ScriptDef; name: string; t: ToolText; lang: Lang; onName: (v: string) => void }> = ({ script, name, t, lang, onName }) => {
  const { script: draft, updateScript } = useToolWizardStore();
  const language = scriptLanguage(script, draft.language);
  const pythonOnly = !!script.languages && !script.languages.includes('node');
  const file = scriptFileName(script, { language: draft.language, fileName: name }, lang);
  const extension = file.slice(file.lastIndexOf('.'));
  return (
    <div>
      <SettingRow label={t.scriptLanguage} description={pythonOnly ? t.onlyPython : language === 'python' ? t.pythonHint : t.nodeHint}>
        <Segmented
          size="sm"
          ariaLabel={t.scriptLanguage}
          value={language}
          onChange={(value) => !pythonOnly && updateScript({ language: value })}
          options={[
            { value: 'python', label: 'Python' },
            { value: 'node', label: 'Node.js' },
          ]}
        />
      </SettingRow>
      <SettingRow label={t.fileName} htmlFor="tool-script-name">
        <input
          id="tool-script-name"
          type="text"
          value={name}
          maxLength={40}
          placeholder={tx(script.fileName, lang)}
          onChange={(e) => onName(e.target.value)}
          className={cn(inputClass, 'w-44 font-mono')}
        />
        <span className="text-xs font-mono text-zinc-500 w-6">{extension}</span>
      </SettingRow>
      <SettingRow label={t.test} description={t.testHint}>
        <Toggle checked={draft.test} onChange={(test) => updateScript({ test })} />
      </SettingRow>
      <p className="flex items-start gap-2 pt-3 text-[11px] text-zinc-500 leading-normal">
        <ShieldCheck size={13} strokeWidth={1.5} className="mt-px shrink-0 text-zinc-400" />
        {script.modifies ? t.safetyModifies : t.safetyReadOnly}
      </p>
    </div>
  );
};

/** Bulk rename: what the settings do to a few sample file names. */
const RenameResult: React.FC<{ values: ParamValues; t: ToolText; lang: Lang }> = ({ values, t, lang }) => {
  const rows = renamePreview(values, lang);
  return (
    <>
      <SectionTitle>{t.previewTitle}</SectionTitle>
      <table className="w-full text-xs">
        <tbody>
          {rows.map((row) => (
            <tr key={row.before} className="border-b border-zinc-800/40 last:border-b-0">
              <td className="py-1.5 pr-3 font-mono text-zinc-500 truncate max-w-0 w-1/2">{row.before}</td>
              <td className="py-1.5 font-mono truncate max-w-0">
                {row.note === 'filtered' ? (
                  <span className="font-sans text-zinc-600">{t.previewFiltered}</span>
                ) : row.note === 'conflict' ? (
                  <span className="font-sans text-amber-400/90">{t.previewConflict}</span>
                ) : row.note === 'same' ? (
                  <span className="font-sans text-zinc-600">{t.previewSame}</span>
                ) : (
                  <span className="text-zinc-200">{row.after}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
};
