import React, { useEffect, useRef, useState } from 'react';
import { FolderOpen, FolderPlus } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useAgentStore } from '@/stores/agentStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSiteWizardStore } from '@/stores/siteWizardStore';
import { useToolWizardStore } from '@/stores/toolWizardStore';
import { getTranslations } from '@/lib/localization/i18n';
import { checkProjectName, compactPath, describeProjectError, joinPath, PROJECT_NAME_MAX } from '@/lib/utils/projects';
import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { SettingRow, inputClass } from './wizard/wizardUi';
import { WebsiteIcon } from './wizard/WebsiteIcon';
import { MiniAppIcon, ScriptIcon } from './wizard/ToolIcons';
import { cn } from '@/lib/utils/cn';

type ProjectKind = 'empty' | 'site' | 'mini' | 'script';

const PARENT_KEY = 'emir.newProject.parent';

function readRememberedParent(): string {
  try {
    return localStorage.getItem(PARENT_KEY) || '';
  } catch {
    return '';
  }
}

function rememberParent(parent: string) {
  try {
    localStorage.setItem(PARENT_KEY, parent);
  } catch {
    /* a convenience only */
  }
}

/** Puts the cursor into the agent's request box once it is on screen. */
export function focusAgentComposer() {
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('textarea[data-agent-composer]')?.focus());
}

/**
 * "Yeni Proje": what to make (empty or one of the wizards), the folder name and where it goes.
 * An empty project's folder is created on "Oluştur"; a wizard's folder when the wizard is
 * confirmed, so a wizard closed halfway leaves nothing on disk.
 */
export const NewProjectDialog: React.FC = () => {
  const open = useUIStore((s) => s.isNewProjectOpen);
  if (!open) return null;
  return <NewProjectForm />;
};

const NewProjectForm: React.FC = () => {
  const closeNewProject = useUIStore((s) => s.closeNewProject);
  const setActiveAppMode = useUIStore((s) => s.setActiveAppMode);
  const language = useSettingsStore((s) => s.settings.language);
  const p = getTranslations(language).projects;
  const [kind, setKind] = useState<ProjectKind>('empty');
  const [name, setName] = useState('');
  const [parentDir, setParentDir] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const api = window.electronAPI;

  useEffect(() => {
    let cancelled = false;
    const remembered = readRememberedParent();
    if (remembered) setParentDir(remembered);
    else api?.getDefaultProjectParent?.(p.defaultFolder).then((dir) => !cancelled && setParentDir(dir));
    requestAnimationFrame(() => nameRef.current?.focus());
    return () => {
      cancelled = true;
    };
  }, []);

  const trimmed = name.trim();
  // Characters a folder cannot have are pointed out while typing; an empty name only on submit.
  const liveProblem = trimmed ? checkProjectName(trimmed) : null;
  const shownError = error || (liveProblem ? describeProjectError(p, liveProblem) : null);
  const target = parentDir && trimmed && !liveProblem ? joinPath(parentDir, trimmed) : '';

  const kinds: Array<{ id: ProjectKind; label: string; icon: React.ReactNode }> = [
    { id: 'empty', label: p.kindEmpty, icon: <FolderPlus size={18} strokeWidth={1.5} /> },
    { id: 'site', label: p.kindSite, icon: <WebsiteIcon size={18} /> },
    { id: 'mini', label: p.kindMini, icon: <MiniAppIcon size={18} /> },
    { id: 'script', label: p.kindScript, icon: <ScriptIcon size={18} /> },
  ];

  const chooseParent = async () => {
    const res = await api?.chooseProjectParent?.({ title: p.chooseLocationTitle, defaultPath: parentDir });
    if (res?.success && res.path) {
      setParentDir(res.path);
      setError(null);
    }
  };

  const openExisting = async () => {
    if (await useAgentStore.getState().openExistingProject()) {
      setActiveAppMode('agent');
      closeNewProject();
      focusAgentComposer();
    }
  };

  const submit = async () => {
    if (busy) return;
    const problem = checkProjectName(trimmed);
    if (problem) {
      setError(describeProjectError(p, problem));
      nameRef.current?.focus();
      return;
    }
    if (!parentDir || !api?.checkProjectTarget) {
      setError(p.errorLocation);
      return;
    }
    const agent = useAgentStore.getState();
    if (!(await agent.confirmLeaveRunningTask())) return;

    setBusy(true);
    try {
      const check = await api.checkProjectTarget(parentDir, trimmed);
      if (!check.ok) {
        setError(describeProjectError(p, check.code, check.error));
        return;
      }
      rememberParent(parentDir);

      if (kind === 'empty') {
        const res = await agent.createProject(parentDir, trimmed);
        if (!res.success) {
          setError(describeProjectError(p, res.code, res.error));
          return;
        }
        setActiveAppMode('agent');
        closeNewProject();
        focusAgentComposer();
        return;
      }

      // The wizards live in the agent view; the folder is created when the wizard is confirmed.
      agent.setPendingProject({ parentDir, name: trimmed, target: check.target });
      if (kind === 'site') {
        const site = useSiteWizardStore.getState();
        if (!site.data.siteName.trim()) site.update({ siteName: trimmed });
        site.openWizard();
      } else {
        useToolWizardStore.getState().openWizard(kind);
      }
      setActiveAppMode('agent');
      closeNewProject();
    } finally {
      setBusy(false);
    }
  };

  const common = getTranslations(language).common;

  return (
    <Modal
      isOpen
      onClose={closeNewProject}
      title={p.dialogTitle}
      width="max-w-lg"
      footer={
        <>
          <Button variant="ghost" icon={<FolderOpen size={14} strokeWidth={1.5} />} onClick={openExisting} disabled={busy}>
            {p.openExisting}
          </Button>
          <span className="flex-1" />
          <Button variant="secondary" onClick={closeNewProject}>
            {common.cancel}
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy || !trimmed || !!liveProblem || !parentDir}>
            {kind === 'empty' ? p.create : p.continue}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="space-y-2">
          <p id="new-project-kind" className="text-xs font-medium text-zinc-300">
            {p.kindLabel}
          </p>
          <div role="radiogroup" aria-labelledby="new-project-kind" className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {kinds.map((k) => {
              const active = k.id === kind;
              return (
                <button
                  key={k.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setKind(k.id)}
                  className={cn(
                    'h-16 flex flex-col items-center justify-center gap-1.5 rounded border text-xs transition-colors cursor-pointer',
                    active ? 'bg-zinc-800 border-zinc-700 text-zinc-100 font-medium' : 'border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
                  )}
                >
                  <span className={active ? 'text-zinc-100' : 'text-zinc-500'}>{k.icon}</span>
                  <span>{k.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <SettingRow label={p.name} htmlFor="new-project-name">
            <input
              ref={nameRef}
              id="new-project-name"
              type="text"
              value={name}
              maxLength={PROJECT_NAME_MAX + 20}
              spellCheck={false}
              autoComplete="off"
              placeholder={p.namePlaceholder}
              aria-invalid={!!shownError}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              className={cn(inputClass, 'w-56')}
            />
          </SettingRow>
          <SettingRow label={p.location}>
            <span className="text-xs font-mono text-zinc-400 truncate max-w-[220px]" title={parentDir}>
              {parentDir || '—'}
            </span>
            <Button variant="secondary" size="sm" onClick={chooseParent} disabled={!api?.chooseProjectParent}>
              {p.change}
            </Button>
          </SettingRow>
        </div>

        <p
          className={cn('text-[11px] min-h-[1rem] truncate', shownError ? 'text-amber-400' : 'text-zinc-500 font-mono')}
          role={shownError ? 'alert' : undefined}
          title={shownError ? undefined : target}
        >
          {shownError || (target ? p.willCreate.replace('{path}', compactPath(target, 3)) : '')}
        </p>

        {/* Submitted by Enter in the name box */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
};
