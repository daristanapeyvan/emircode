import React, { useState, useEffect } from 'react';
import { AppLogo } from '../common/AppLogo';
import { useSettingsStore } from '@/stores/settingsStore';
import { useModelStore } from '@/stores/modelStore';
import { getTranslations } from '@/lib/localization/i18n';
import { PrerequisiteStatus } from '../../../electron/preload';
import {
  ShieldCheck,
  Cpu,
  Terminal,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Download,
  ArrowRight,
  ArrowLeft,
  RefreshCw,
  X,
  Play,
  Info,
  Sparkles,
  Layers,
  HardDrive,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { formatBytes } from '@/lib/utils/formatters';

const ONBOARDING_KEY = 'emir_code_onboarding_completed';

interface CuratedModelOption {
  id: string;
  name: string;
  size: string;
  desc: string;
  tag: string;
  recommendedRam: string;
}

export const OnboardingModal: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);

  // Prerequisites state
  const [prereqs, setPrereqs] = useState<PrerequisiteStatus | null>(null);
  const [isCheckingPrereqs, setIsCheckingPrereqs] = useState(false);
  const [installingTarget, setInstallingTarget] = useState<'ollama' | 'node' | null>(null);
  const [installerNotice, setInstallerNotice] = useState<string | null>(null);

  // Model store
  const {
    installedModels,
    selectedModel,
    selectModel,
    fetchModels,
    pullModel,
    downloads,
    checkConnection,
  } = useModelStore();

  const { settings, updateSettings } = useSettingsStore();
  const t = getTranslations(settings.language);

  const curatedModels: CuratedModelOption[] = [
    {
      id: 'qwen2.5-coder:7b',
      name: 'Qwen 2.5 Coder 7B',
      size: '4.7 GB',
      desc: t.onboarding.modelQwen7bDesc,
      tag: t.onboarding.tagRecommended,
      recommendedRam: '8 GB RAM',
    },
    {
      id: 'qwen2.5-coder:1.5b',
      name: 'Qwen 2.5 Coder 1.5B',
      size: '1.0 GB',
      desc: t.onboarding.modelQwen15bDesc,
      tag: t.onboarding.tagLightweight,
      recommendedRam: '4 GB RAM',
    },
    {
      id: 'qwen3:8b',
      name: 'Qwen3 8B',
      size: '5.2 GB',
      desc: t.onboarding.modelQwen3Desc,
      tag: t.onboarding.tagReasoning,
      recommendedRam: '8 GB RAM',
    },
    {
      id: 'llama3.1:8b',
      name: 'Llama 3.1 8B',
      size: '4.7 GB',
      desc: t.onboarding.modelLlamaDesc,
      tag: t.onboarding.tagGeneral,
      recommendedRam: '8 GB RAM',
    },
  ];

  // Check if onboarding was completed previously
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
      if (res?.message) {
        setInstallerNotice(res.message);
      }
      // Re-scan after short delay
      setTimeout(() => {
        checkAllPrerequisites();
      }, 3000);
    } catch (err: any) {
      setInstallerNotice(`Kurulum hatası: ${err.message}`);
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
      selectModel(modelName);
      updateSettings({ defaultModel: modelName });
    } catch (err) {
      console.error('Pull failed:', err);
    }
  };

  const handleClose = () => {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    setIsOpen(false);
  };

  if (!isOpen) return null;

  const isOllamaReady = prereqs?.ollama.installed && prereqs?.ollama.running;
  const isNodeReady = prereqs?.node.installed && prereqs?.node.satisfiesVersion;
  const canProceedToStep2 = isOllamaReady;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col relative max-h-[90vh]">
        {/* Header Bar */}
        <div className="p-4 px-6 border-b border-zinc-800 bg-zinc-950/70 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <AppLogo size={24} />
            <div>
              <h2 className="text-sm font-semibold text-zinc-100 tracking-tight">
                {t.onboarding?.welcomeTitle || "Emir Code'a Hoş Geldiniz"}
              </h2>
              <p className="text-[11px] text-zinc-400">
                {t.onboarding?.welcomeSubtitle || 'Yerel ve Özel Yapay Zekâ Kodlama Ajanı Kurulumu'}
              </p>
            </div>
          </div>

          {/* Stepper indicators */}
          <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-400">
            <span
              className={cn(
                'px-2 py-0.5 rounded-full text-[11px]',
                currentStep === 1 ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' : 'text-zinc-500'
              )}
            >
              1. {t.onboarding?.step1Title || 'Sistem'}
            </span>
            <span className="text-zinc-600">/</span>
            <span
              className={cn(
                'px-2 py-0.5 rounded-full text-[11px]',
                currentStep === 2 ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' : 'text-zinc-500'
              )}
            >
              2. {t.onboarding?.step2Title || 'Model'}
            </span>
            <span className="text-zinc-600">/</span>
            <span
              className={cn(
                'px-2 py-0.5 rounded-full text-[11px]',
                currentStep === 3 ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' : 'text-zinc-500'
              )}
            >
              3. {t.onboarding?.step3Title || 'Hazır'}
            </span>
          </div>

          <button
            onClick={handleClose}
            className="p-1 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/80 transition-colors cursor-pointer"
            title={t.common.close}
          >
            <X size={16} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {/* STEP 1: PREREQUISITES & AUTOMATIC INSTALL */}
          {currentStep === 1 && (
            <div className="space-y-4 animate-in fade-in duration-150">
              {/* External Download Transparency Notice */}
              <div className="p-3.5 rounded-xl bg-amber-950/20 border border-amber-600/30 text-amber-200 text-xs flex gap-2.5 items-start">
                <Info size={16} className="text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <span className="font-semibold text-amber-300 block">
                    {t.onboarding.externalDownloadNoticeTitle}
                  </span>
                  <p className="text-amber-200/90 leading-relaxed text-[11px]">
                    {t.onboarding.externalDownloadNoticeDesc}
                  </p>
                </div>
              </div>

              {/* Status Message from Installer */}
              {installerNotice && (
                <div className="p-3 rounded-lg bg-cyan-950/40 border border-cyan-700/50 text-cyan-200 text-xs flex items-center justify-between">
                  <span>{installerNotice}</span>
                  <button
                    onClick={() => setInstallerNotice(null)}
                    className="text-cyan-400 hover:text-white"
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Requirements Cards */}
              <div className="space-y-2.5">
                {/* 1. Ollama Card */}
                <div className="p-3.5 rounded-xl bg-zinc-950/80 border border-zinc-800/80 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
                      <Cpu size={18} className="text-purple-400" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-zinc-100">Ollama</span>
                        {isOllamaReady ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-950/80 border border-emerald-700 text-emerald-300 flex items-center gap-1">
                            <CheckCircle2 size={10} />
                            {t.onboarding.ollamaStatusRunning}
                          </span>
                        ) : prereqs?.ollama.installed ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-950/80 border border-amber-700 text-amber-300">
                            {t.onboarding.ollamaStatusStopped}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-950/80 border border-red-700 text-red-300">
                            {t.onboarding.ollamaStatusMissing}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-zinc-400 mt-0.5">
                        {isOllamaReady
                          ? t.onboarding.ollamaReadyDesc
                          : prereqs?.ollama.installed
                          ? t.onboarding.ollamaStoppedDesc
                          : t.onboarding.ollamaMissingDesc}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isOllamaReady ? (
                      <span className="text-[11px] text-zinc-500 font-mono">
                        {t.onboarding.alreadyInstalledBadge}
                      </span>
                    ) : prereqs?.ollama.installed ? (
                      <button
                        onClick={handleStartOllama}
                        disabled={isCheckingPrereqs}
                        className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
                      >
                        <Play size={12} />
                        <span>{t.onboarding.startOllamaService}</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleInstall('ollama')}
                        disabled={installingTarget === 'ollama'}
                        className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
                      >
                        {installingTarget === 'ollama' ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Download size={12} />
                        )}
                        <span>{t.onboarding.installOllama}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* 2. Node.js Card */}
                <div className="p-3.5 rounded-xl bg-zinc-950/80 border border-zinc-800/80 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
                      <Terminal size={18} className="text-emerald-400" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-zinc-100">Node.js (v18+) & npm</span>
                        {isNodeReady ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-950/80 border border-emerald-700 text-emerald-300 flex items-center gap-1">
                            <CheckCircle2 size={10} />
                            {prereqs?.node.version || 'Ready'}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-950/80 border border-amber-700 text-amber-300">
                            {t.onboarding.nodeStatusMissing}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-zinc-400 mt-0.5">
                        {isNodeReady
                          ? `Node.js (${prereqs?.node.version}) & npm (${prereqs?.npm.version || 'ok'})`
                          : t.onboarding.nodeMissingDesc}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isNodeReady ? (
                      <span className="text-[11px] text-zinc-500 font-mono">
                        {t.onboarding?.alreadyInstalledBadge || 'Sistemde Kurulu (Atlandı)'}
                      </span>
                    ) : (
                      <button
                        onClick={() => handleInstall('node')}
                        disabled={installingTarget === 'node'}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
                      >
                        {installingTarget === 'node' ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Download size={12} />
                        )}
                        <span>{t.onboarding?.installNode || 'Node.js İndir & Kur'}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Re-scan button */}
              <div className="flex justify-end pt-1">
                <button
                  onClick={checkAllPrerequisites}
                  disabled={isCheckingPrereqs}
                  className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                >
                  <RefreshCw size={12} className={cn(isCheckingPrereqs && 'animate-spin')} />
                  <span>{t.onboarding?.recheck || 'Sistemi Tekrar Tara'}</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: MODEL SELECTION & AUTO-PULL */}
          {currentStep === 2 && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <p className="text-xs text-zinc-400 leading-relaxed">
                {t.onboarding?.step2Subtitle ||
                  'Bilgisayarınızda kurulu olan modellerden birini seçebilir veya önerilen kodlama modellerini tek tıkla arayüz üzerinden indirebilirsiniz.'}
              </p>

              {/* Already Installed Local Models */}
              {installedModels.length > 0 && (
                <div className="space-y-2">
                  <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                    <CheckCircle2 size={13} className="text-emerald-400" />
                    <span>{t.onboarding?.installedModelsTitle || 'Bilgisayarınızda Kurulu Yerel Modeller'}</span>
                  </span>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {installedModels.map((m) => {
                      const isSelected = selectedModel === m.name;
                      return (
                        <div
                          key={m.name}
                          onClick={() => handleSelectModel(m.name)}
                          className={cn(
                            'p-3 rounded-xl border text-xs cursor-pointer transition-all flex flex-col justify-between',
                            isSelected
                              ? 'bg-cyan-950/30 border-cyan-500 shadow-sm ring-1 ring-cyan-500/50'
                              : 'bg-zinc-950/70 border-zinc-800 hover:border-zinc-700 text-zinc-300'
                          )}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-semibold text-zinc-100 truncate">{m.name}</span>
                            <span className="text-[10px] text-zinc-400 font-mono">
                              {formatBytes(m.size)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between mt-2">
                            <span className="text-[10px] text-zinc-500 uppercase font-mono">
                              {m.details?.parameter_size || m.details?.family || 'Yerel'}
                            </span>
                            {isSelected ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-600 text-white">
                                {t.onboarding.modelReady}
                              </span>
                            ) : (
                              <span className="text-[10px] text-zinc-400 hover:text-zinc-200">
                                {t.onboarding.selectModelBtn}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Curated Recommended Coding Models */}
              <div className="space-y-2 pt-2">
                <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                  <Sparkles size={13} className="text-amber-400" />
                  <span>{t.onboarding.recommendedModelsTitle}</span>
                </span>

                <div className="space-y-2">
                  {curatedModels.map((opt) => {
                    const isInstalled = installedModels.some((m) => m.name === opt.id);
                    const isSelected = selectedModel === opt.id;
                    const activeDownload = downloads[opt.id];

                    return (
                      <div
                        key={opt.id}
                        className={cn(
                          'p-3.5 rounded-xl border text-xs transition-all flex flex-col gap-2',
                          isSelected
                            ? 'bg-cyan-950/30 border-cyan-500/80 shadow-sm ring-1 ring-cyan-500/40'
                            : 'bg-zinc-950/70 border-zinc-800/80 hover:border-zinc-700'
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-zinc-100 text-xs">{opt.name}</span>
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-800 text-zinc-300">
                                {opt.tag}
                              </span>
                              <span className="text-[10px] text-zinc-500 font-mono">
                                ({opt.size} • {opt.recommendedRam})
                              </span>
                            </div>
                            <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                              {opt.desc}
                            </p>
                          </div>

                          <div className="shrink-0 flex items-center gap-2">
                            {isInstalled ? (
                              <button
                                onClick={() => handleSelectModel(opt.id)}
                                className={cn(
                                  'px-3 py-1 rounded-lg text-xs font-medium cursor-pointer transition-colors',
                                  isSelected
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
                                )}
                              >
                                {isSelected ? t.onboarding.activeModelBadge : t.onboarding.selectModelBtn}
                              </button>
                            ) : activeDownload ? (
                              <div className="text-right">
                                <span className="text-[11px] font-mono text-cyan-400 font-medium">
                                  %{activeDownload.percentage}
                                </span>
                              </div>
                            ) : (
                              <button
                                onClick={() => handlePullModel(opt.id)}
                                className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
                              >
                                <Download size={12} />
                                <span>{t.onboarding.downloadAndSelect}</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Live Download Progress Bar */}
                        {activeDownload && (
                          <div className="space-y-1.5 pt-1 border-t border-zinc-800/80">
                            <div className="flex items-center justify-between text-[10px] text-zinc-400 font-mono">
                              <span>
                                {activeDownload.status || t.onboarding.downloading} (
                                {formatBytes(activeDownload.completed)} /{' '}
                                {formatBytes(activeDownload.total)})
                              </span>
                              <span>{activeDownload.speed || ''}</span>
                            </div>
                            <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-cyan-500 transition-all duration-300"
                                style={{ width: `${activeDownload.percentage}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: READY & CONFIRMATION */}
          {currentStep === 3 && (
            <div className="space-y-4 text-center py-4 animate-in fade-in duration-150">
              <div className="w-14 h-14 rounded-2xl bg-emerald-950/60 border border-emerald-600/40 flex items-center justify-center mx-auto text-emerald-400 shadow-lg shadow-emerald-950/50">
                <ShieldCheck size={30} />
              </div>

              <div>
                <h3 className="text-base font-bold text-zinc-100">
                  {t.onboarding.readyToCodeTitle}
                </h3>
                <p className="text-xs text-zinc-400 max-w-md mx-auto mt-1 leading-relaxed">
                  {t.onboarding.readyToCodeSubtitle}
                </p>
              </div>

              {/* Summary Badges */}
              <div className="max-w-md mx-auto p-4 rounded-xl bg-zinc-950/80 border border-zinc-800 space-y-2 text-left text-xs font-sans">
                <div className="flex items-center justify-between py-1 border-b border-zinc-800/80">
                  <span className="text-zinc-400">{t.onboarding.selectedModelLabel}</span>
                  <span className="text-cyan-400 font-semibold font-mono">
                    {selectedModel || 'qwen2.5-coder:7b'}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-zinc-800/80">
                  <span className="text-zinc-400">{t.onboarding.ollamaServiceLabel}</span>
                  <span className="text-emerald-400 font-medium">{t.onboarding.ollamaRunningReady}</span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-zinc-800/80">
                  <span className="text-zinc-400">{t.onboarding.securityLayerLabel}</span>
                  <span className="text-purple-400 font-medium">{t.onboarding.securityLayerDesc}</span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-zinc-400">{t.onboarding.privacyLabel}</span>
                  <span className="text-emerald-400 font-medium">{t.onboarding.privacyDesc}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="p-4 px-6 border-t border-zinc-800 bg-zinc-950/70 flex items-center justify-between shrink-0">
          {currentStep > 1 ? (
            <button
              onClick={() => setCurrentStep((Math.max(1, currentStep - 1) as 1 | 2 | 3))}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
            >
              <ArrowLeft size={13} />
              <span>{t.onboarding?.back || 'Geri'}</span>
            </button>
          ) : (
            <div />
          )}

          {currentStep === 1 && (
            <button
              onClick={() => setCurrentStep(2)}
              disabled={!canProceedToStep2}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-30 disabled:hover:bg-cyan-600 text-white text-xs font-semibold shadow-md shadow-cyan-950/40 transition-colors cursor-pointer"
            >
              <span>{t.onboarding?.continue || 'Devam Et'}</span>
              <ArrowRight size={13} />
            </button>
          )}

          {currentStep === 2 && (
            <button
              onClick={() => setCurrentStep(3)}
              disabled={!selectedModel}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-30 disabled:hover:bg-cyan-600 text-white text-xs font-semibold shadow-md shadow-cyan-950/40 transition-colors cursor-pointer"
            >
              <span>{t.onboarding?.continue || 'Devam Et'}</span>
              <ArrowRight size={13} />
            </button>
          )}

          {currentStep === 3 && (
            <button
              onClick={handleClose}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-950/50 transition-colors cursor-pointer"
            >
              <Sparkles size={14} />
              <span>{t.onboarding?.finishAndLaunch || "Emir Code'u Başlat"}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
