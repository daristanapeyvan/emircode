import React, { useState, useEffect } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useModelStore } from '@/stores/modelStore';
import { getTranslations } from '@/lib/localization/i18n';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { cn } from '@/lib/utils/cn';
import { formatBytes } from '@/lib/utils/formatters';
import { PrerequisiteStatus } from '../../../electron/preload';

const ONBOARDING_KEY = 'emir_code_onboarding_completed';

interface CuratedModelOption {
  id: string;
  name: string;
  size: string;
  desc: string;
  note?: string;
  recommendedRam: string;
}

/** One requirement: name, its state in plain words and the one action it needs. */
const Requirement: React.FC<{ name: string; state: string; ok: boolean; pending?: boolean; hint?: string; action?: React.ReactNode }> = ({ name, state, ok, pending, hint, action }) => (
  <div className="flex items-center justify-between gap-4 py-3 border-b border-zinc-800/60">
    <div className="min-w-0 space-y-0.5">
      <p className="text-xs font-medium text-zinc-200">
        {name} <span className={cn('font-normal', pending ? 'text-zinc-500' : ok ? 'text-emerald-400' : 'text-amber-400')}>· {state}</span>
      </p>
      {hint && <p className="text-[11px] text-zinc-500 leading-normal">{hint}</p>}
    </div>
    {action}
  </div>
);

export const OnboardingModal: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState<1 | 2>(1);

  const [prereqs, setPrereqs] = useState<PrerequisiteStatus | null>(null);
  const [isCheckingPrereqs, setIsCheckingPrereqs] = useState(false);
  const [installingTarget, setInstallingTarget] = useState<'ollama' | 'node' | null>(null);
  const [installerNotice, setInstallerNotice] = useState<string | null>(null);

  const { installedModels, selectedModel, selectModel, fetchModels, pullModel, downloads, checkConnection } = useModelStore();
  const { settings, updateSettings } = useSettingsStore();
  const t = getTranslations(settings.language);
  const o = t.onboarding;

  const curatedModels: CuratedModelOption[] = [
    { id: 'qwen2.5-coder:7b', name: 'Qwen 2.5 Coder 7B', size: '4.7 GB', desc: o.modelQwen7bDesc, note: o.tagRecommended, recommendedRam: '8 GB RAM' },
    { id: 'qwen2.5-coder:1.5b', name: 'Qwen 2.5 Coder 1.5B', size: '1.0 GB', desc: o.modelQwen15bDesc, recommendedRam: '4 GB RAM' },
    { id: 'qwen3:8b', name: 'Qwen3 8B', size: '5.2 GB', desc: o.modelQwen3Desc, recommendedRam: '8 GB RAM' },
    { id: 'llama3.1:8b', name: 'Llama 3.1 8B', size: '4.7 GB', desc: o.modelLlamaDesc, recommendedRam: '8 GB RAM' },
  ];

  useEffect(() => {
    const seen = localStorage.getItem(ONBOARDING_KEY);
    if (!seen) {
      setIsOpen(true);
      checkAllPrerequisites();
    }
  }, []);

  const checkAllPrerequisites = async () => {
    setIsCheckingPrereqs(true);
    setInstallerNotice(null);
    try {
      if (window.electronAPI?.checkPrerequisites) {
        const status = await window.electronAPI.checkPrerequisites();
        setPrereqs(status);
        if (status.ollama.running) {
          await checkConnection();
          await fetchModels();
        }
      }
    } catch (err: any) {
      console.error('Failed to check prerequisites:', err);
    } finally {
      setIsCheckingPrereqs(false);
    }
  };

  const handleStartOllama = async () => {
    setIsCheckingPrereqs(true);
    try {
      await window.electronAPI?.startOllamaService?.();
      await checkAllPrerequisites();
    } finally {
      setIsCheckingPrereqs(false);
    }
  };

  const handleInstall = async (target: 'ollama' | 'node') => {
    setInstallingTarget(target);
    setInstallerNotice(null);
    try {
      const res = await window.electronAPI?.installPrerequisite?.(target);
      if (res?.message) setInstallerNotice(res.message);
      // Look again once the installer had a moment.
      setTimeout(() => checkAllPrerequisites(), 3000);
    } catch (err: any) {
      setInstallerNotice(o.installError.replace('{error}', err.message));
    } finally {
      setInstallingTarget(null);
    }
  };

  const handleSelectModel = (modelName: string) => {
    selectModel(modelName);
    updateSettings({ defaultModel: modelName });
  };

  const handlePullModel = async (modelName: string) => {
    try {
      await pullModel(modelName);
      handleSelectModel(modelName);
    } catch (err) {
      console.error('Pull failed:', err);
    }
  };

  const handleClose = () => {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    setIsOpen(false);
  };

  if (!isOpen) return null;

  const isOllamaReady = !!(prereqs?.ollama.installed && prereqs?.ollama.running);
  const isNodeReady = !!(prereqs?.node.installed && prereqs?.node.satisfiesVersion);
  const notInstalled = curatedModels.filter((opt) => !installedModels.some((m) => m.name === opt.id));

  const installButton = (target: 'ollama' | 'node') => (
    <Button
      variant="primary"
      size="sm"
      disabled={installingTarget === target}
      icon={installingTarget === target ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
      onClick={() => handleInstall(target)}
    >
      {o.install}
    </Button>
  );

  return (
    <Modal
      isOpen
      onClose={handleClose}
      dismissible={false}
      title={o.welcomeTitle}
      width="max-w-xl"
      footer={
        <>
          <span className="text-[11px] text-zinc-500 tabular-nums">{o.stepOf.replace('{current}', String(currentStep)).replace('{total}', '2')}</span>
          <span className="flex-1" />
          {currentStep === 2 && (
            <Button variant="secondary" onClick={() => setCurrentStep(1)}>
              {o.back}
            </Button>
          )}
          {currentStep === 1 ? (
            <Button variant="primary" disabled={!isOllamaReady} onClick={() => setCurrentStep(2)}>
              {o.continue}
            </Button>
          ) : (
            <Button variant="primary" disabled={!selectedModel} onClick={handleClose}>
              {o.finishAndLaunch}
            </Button>
          )}
        </>
      }
    >
      {currentStep === 1 ? (
        <div className="text-xs">
          <p className="text-zinc-400 pb-1">{o.step1Subtitle}</p>

          <Requirement
            name="Ollama"
            ok={isOllamaReady}
            pending={!prereqs}
            state={!prereqs ? o.checking : isOllamaReady ? o.ollamaStatusRunning : prereqs.ollama.installed ? o.ollamaStatusStopped : o.ollamaStatusMissing}
            hint={prereqs && !prereqs.ollama.installed ? o.ollamaMissingDesc : undefined}
            action={
              !prereqs || isOllamaReady ? undefined : prereqs.ollama.installed ? (
                <Button variant="primary" size="sm" disabled={isCheckingPrereqs} onClick={handleStartOllama}>
                  {o.startOllamaService}
                </Button>
              ) : (
                installButton('ollama')
              )
            }
          />
          <Requirement
            name="Node.js"
            ok={isNodeReady}
            pending={!prereqs}
            state={!prereqs ? o.checking : isNodeReady ? prereqs.node.version || o.nodeStatusReady : o.nodeStatusMissing}
            hint={prereqs && !isNodeReady ? o.nodeMissingDesc : undefined}
            action={prereqs && !isNodeReady ? installButton('node') : undefined}
          />

          {installerNotice && <p className="pt-3 text-zinc-300">{installerNotice}</p>}

          <div className="flex items-center justify-between gap-4 pt-3">
            <p className="text-[11px] text-zinc-500 leading-relaxed">{o.externalDownloadNoticeDesc}</p>
            <Button
              variant="ghost"
              size="sm"
              disabled={isCheckingPrereqs}
              icon={<RefreshCw size={12} className={cn(isCheckingPrereqs && 'animate-spin')} />}
              onClick={checkAllPrerequisites}
            >
              {o.recheck}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4 text-xs">
          <p className="text-zinc-400">{o.step2Subtitle}</p>

          {installedModels.length > 0 && (
            <section className="space-y-1.5">
              <h3 className="font-medium text-zinc-400">{o.installedModelsTitle}</h3>
              <div role="radiogroup" className="rounded-md border border-zinc-800 divide-y divide-zinc-800">
                {installedModels.map((m) => {
                  const checked = selectedModel === m.name;
                  return (
                    <button
                      key={m.name}
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      onClick={() => handleSelectModel(m.name)}
                      className={cn('w-full flex items-center gap-3 px-3 py-2 text-left transition-colors cursor-pointer', checked ? 'bg-zinc-800/60' : 'hover:bg-zinc-800/30')}
                    >
                      <span className={cn('w-3.5 h-3.5 rounded-full border shrink-0 flex items-center justify-center', checked ? 'border-zinc-300' : 'border-zinc-600')}>
                        {checked && <span className="w-1.5 h-1.5 rounded-full bg-zinc-200" />}
                      </span>
                      <span className="flex-1 min-w-0 font-mono text-zinc-100 truncate">{m.name}</span>
                      <span className="text-[11px] text-zinc-500 shrink-0">{formatBytes(m.size)}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {notInstalled.length > 0 && (
            <section className="space-y-1.5">
              <h3 className="font-medium text-zinc-400">{o.recommendedModelsTitle}</h3>
              <div className="rounded-md border border-zinc-800 divide-y divide-zinc-800">
                {notInstalled.map((opt) => {
                  const activeDownload = downloads[opt.id];
                  return (
                    <div key={opt.id} className="px-3 py-2.5 space-y-1.5">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-zinc-100">
                            {opt.name}{' '}
                            <span className="text-zinc-500">
                              · {opt.size} · {opt.recommendedRam}
                              {opt.note ? ` · ${opt.note}` : ''}
                            </span>
                          </p>
                          <p className="text-[11px] text-zinc-500">{opt.desc}</p>
                        </div>
                        {activeDownload ? (
                          <span className="text-[11px] text-zinc-400 tabular-nums shrink-0">{activeDownload.percentage}%</span>
                        ) : (
                          <Button variant="secondary" size="sm" icon={<Download size={12} />} onClick={() => handlePullModel(opt.id)}>
                            {t.common.download}
                          </Button>
                        )}
                      </div>
                      {activeDownload && (
                        <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
                          <div className="h-full bg-zinc-400 transition-all duration-300" style={{ width: `${activeDownload.percentage}%` }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
};
