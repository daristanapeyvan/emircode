import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Check, RotateCcw } from 'lucide-react';
import { useSiteWizardStore, isDraftStarted } from '@/stores/siteWizardStore';
import { useAgentStore } from '@/stores/agentStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations, resolveLanguage, Translations } from '@/lib/localization/i18n';
import { compileSitePrompt } from '@/lib/wizard/siteWizard';
import { Segmented } from './wizardUi';
import { StepSite } from './StepSite';
import { StepDesign } from './StepDesign';
import { StepStructure } from './StepStructure';
import { StepPages } from './StepPages';
import { StepContact, StepFeatures } from './StepDetails';
import { StepSummary } from './StepSummary';
import { Button } from '@/components/common/Button';
import { IconButton } from '@/components/common/IconButton';
import { cn } from '@/lib/utils/cn';

export type WizardText = Translations['wizard'];

type StepId = 'site' | 'design' | 'structure' | 'pages' | 'contact' | 'features' | 'summary';

const STEPS: Record<'simple' | 'detailed', StepId[]> = {
  simple: ['site', 'design', 'structure', 'summary'],
  detailed: ['site', 'design', 'pages', 'contact', 'features', 'summary'],
};

/** The "Website Oluştur" wizard: answers -> generated request -> composer (the user sends it). */
export const SiteWizard: React.FC = () => {
  const { open, step, data, closeWizard, setStep, setMode, reset } = useSiteWizardStore();
  const { workspaceRoot, agentStatus, setWizardDraft, openWorkspaceDialog } = useAgentStore();
  const language = useSettingsStore((s) => s.settings.language);
  const w = getTranslations(language).wizard;
  const lang = resolveLanguage(language);
  const [showErrors, setShowErrors] = useState(false);
  const [restored, setRestored] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const steps = STEPS[data.mode];
  const current = Math.min(step, steps.length - 1);
  const stepId = steps[current];
  const isLast = current === steps.length - 1;
  const busy = agentStatus !== 'idle' && agentStatus !== 'finished' && agentStatus !== 'error';
  const nameMissing = !data.siteName.trim();

  // Opening with a draft from before: say so once.
  useEffect(() => {
    if (open) setRestored(isDraftStarted(useSiteWizardStore.getState().data));
    else setShowErrors(false);
  }, [open]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [stepId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) closeWizard();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closeWizard]);

  const stepTitles: Record<StepId, string> = useMemo(
    () => ({
      site: w.stepSite,
      design: w.stepDesign,
      structure: w.stepStructure,
      pages: w.stepPages,
      contact: w.stepContact,
      features: w.stepFeatures,
      summary: w.stepSummary,
    }),
    [w]
  );

  if (!open) return null;

  const goTo = (target: number) => {
    if (target > 0 && nameMissing) {
      setShowErrors(true);
      setStep(0);
      return;
    }
    setStep(Math.max(0, Math.min(target, steps.length - 1)));
  };

  /** Puts the request into the composer; nothing starts until the user presses send. */
  const confirm = async () => {
    if (nameMissing) {
      setShowErrors(true);
      setStep(0);
      return;
    }
    if (busy) return;
    if (!useAgentStore.getState().workspaceRoot) {
      await openWorkspaceDialog();
      if (!useAgentStore.getState().workspaceRoot) return;
    }
    const compiled = compileSitePrompt(useSiteWizardStore.getState().data);
    setWizardDraft({
      kind: 'site',
      // The badge already names the wizard: drop the "Mini Uygulama:" style prefix.
      label: compiled.displayGoal.replace(/^[^:"]+:\s*/, ''),
      prompt: compiled.prompt,
      options: { displayGoal: compiled.displayGoal, checklist: compiled.checklist, design: compiled.design },
    });
    closeWizard();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-[2px]" onClick={closeWizard} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="site-wizard-title"
        lang={lang}
        className="relative z-10 w-full max-w-6xl h-[min(90vh,860px)] bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-zinc-800/80">
          <h2 id="site-wizard-title" className="text-sm font-semibold text-zinc-100 tracking-tight">
            {w.title}
          </h2>
          <div className="ml-auto flex items-center gap-2">
            <Segmented
              ariaLabel={w.modeSimple}
              value={data.mode}
              onChange={(mode) => setMode(mode)}
              options={[
                { value: 'simple', label: w.modeSimple, title: w.modeSimpleHint },
                { value: 'detailed', label: w.modeDetailed, title: w.modeDetailedHint },
              ]}
            />
            <button
              type="button"
              onClick={() => {
                if (!isDraftStarted(data) || window.confirm(w.resetConfirm)) {
                  reset();
                  setRestored(false);
                  setShowErrors(false);
                }
              }}
              title={w.reset}
              className="hidden sm:inline-flex items-center gap-1 h-7 px-2 rounded text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 transition-colors cursor-pointer"
            >
              <RotateCcw size={12} strokeWidth={1.5} /> {w.reset}
            </button>
            <IconButton label={w.close} icon={<X size={16} strokeWidth={1.5} />} onClick={closeWizard} size="sm" />
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Stepper */}
          <nav aria-label={w.title} className="hidden md:flex w-48 shrink-0 flex-col gap-0.5 p-2 border-r border-zinc-800/40 select-none">
            {steps.map((id, i) => {
              const done = i < current;
              const active = i === current;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => goTo(i)}
                  aria-current={active ? 'step' : undefined}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 py-2 rounded text-xs text-left transition-colors cursor-pointer',
                    active ? 'bg-zinc-800 text-zinc-100 font-medium' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
                  )}
                >
                  <span className={cn('w-4 flex justify-center tabular-nums', active ? 'text-blue-400' : 'text-zinc-500')}>
                    {done ? <Check size={13} strokeWidth={2} /> : i + 1}
                  </span>
                  <span className="truncate">{stepTitles[id]}</span>
                </button>
              );
            })}
          </nav>

          {/* Step content */}
          <div ref={bodyRef} className="flex-1 min-w-0 overflow-y-auto px-5 sm:px-7 py-6">
            {restored && current === 0 && (
              <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded bg-zinc-800/50 text-xs text-zinc-300">
                <span className="flex-1">{w.draftRestored}</span>
                <button
                  type="button"
                  onClick={() => {
                    reset();
                    setRestored(false);
                  }}
                  className="text-blue-400 hover:text-blue-300 cursor-pointer"
                >
                  {w.reset}
                </button>
              </div>
            )}
            {stepId === 'site' && <StepSite w={w} showErrors={showErrors} />}
            {stepId === 'design' && <StepDesign w={w} />}
            {stepId === 'structure' && <StepStructure w={w} lang={lang} />}
            {stepId === 'pages' && <StepPages w={w} lang={lang} />}
            {stepId === 'contact' && <StepContact w={w} />}
            {stepId === 'features' && <StepFeatures w={w} />}
            {stepId === 'summary' && <StepSummary w={w} lang={lang} />}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-zinc-800/80">
          <span className="md:hidden text-[11px] text-zinc-500 tabular-nums">
            {w.stepOf.replace('{current}', String(current + 1)).replace('{total}', String(steps.length))}
          </span>
          <p className={cn('flex-1 min-w-0 truncate text-[11px] text-right pr-1', busy ? 'text-amber-300' : 'text-zinc-500')}>
            {isLast && (busy ? w.agentBusy : !workspaceRoot ? w.folderNone : w.confirmHint)}
          </p>
          <Button variant="secondary" size="md" onClick={() => goTo(current - 1)} disabled={current === 0}>
            {w.back}
          </Button>
          {isLast ? (
            <Button variant="primary" size="md" onClick={confirm} disabled={busy}>
              {w.create}
            </Button>
          ) : (
            <Button variant="primary" size="md" onClick={() => goTo(current + 1)}>
              {w.next}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
