import React, { useState, useEffect, useRef } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { FileTree } from './FileTree';
import { ChangesetModal } from './ChangesetModal';
import { DeleteApprovalModal } from './DeleteApprovalModal';
import { CommandApprovalModal } from './CommandApprovalModal';
import {
  FolderOpen,
  FolderTree,
  Play,
  Square,
  RotateCcw,
  ShieldCheck,
  Shield,
  Terminal,
  FileCode,
  CheckCircle2,
  AlertCircle,
  Clock,
  Brain,
  Loader2,
  PanelRight,
  Trash2,
  HelpCircle,
  Send,
  Activity,
  ChevronDown,
  ChevronUp,
  X,
  ArrowUp,
  Zap,
} from 'lucide-react';
import { AppLogo } from '../common/AppLogo';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';
import { cn } from '@/lib/utils/cn';
import { SecurityProfile } from '@/types/settings';
import { tokenizeCode, getTokenClassName } from '@/lib/utils/SyntaxHighlighter';

export const AgentWorkspace: React.FC = () => {
  const {
    workspaceRoot,
    workspaceName,
    workspaceFiles,
    activeFile,
    openFiles,
    activeTabId,
    agentStatus,
    steps,
    executionLogs,
    appliedTransactions,
    showReasoningDump,
    activeStreamText,
    isStreamingResponse,
    inlineTranscriptOpen,
    pendingChangeset,
    pendingDelete,
    pendingCommand,
    pendingQuestion,
    toggleReasoningDump,
    toggleInlineTranscript,
    setInlineTranscriptOpen,
    init,
    openWorkspaceDialog,
    openFile,
    closeFileTab,
    closeAllFileTabs,
    setActiveTabId,
    startGoal,
    stopGoal,
    interruptGoal,
    rollbackAll,
    clearSession,
    submitAnswer,
  } = useAgentStore();

  const { settings, updateSettings } = useSettingsStore();
  const t = getTranslations(settings.language);

  const [goalInput, setGoalInput] = useState('');
  const [customAnswerText, setCustomAnswerText] = useState('');
  const [isExplorerOpen, setIsExplorerOpen] = useState(true);
  const [dumpTab, setDumpTab] = useState<'reasoning' | 'logs' | 'raw'>('reasoning');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    init();
  }, []);

  // Auto-resize textarea height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.min(scrollHeight, 180)}px`;
    }
  }, [goalInput]);

  const handleInterrupt = () => {
    if (!goalInput.trim()) return;
    const text = goalInput.trim();
    setGoalInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    interruptGoal(text);
  };

  const handleStart = () => {
    if (isBusy) {
      if (goalInput.trim()) {
        handleInterrupt();
      } else {
        stopGoal();
      }
      return;
    }
    if (!goalInput.trim() || !workspaceRoot) return;
    const textToSend = goalInput;
    setGoalInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    startGoal(textToSend);
  };

  const isBusy = agentStatus === 'thinking' || agentStatus === 'running_command';

  // Get active model reasoning thoughts
  const thoughts = steps.filter((s) => s.type === 'thought');
  const latestThought = thoughts[thoughts.length - 1];

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-canvas-dark text-zinc-200">
      {/* Workspace Sub-Header / Control Bar */}
      <div className="h-9 px-3 border-b border-zinc-800/60 bg-zinc-950/40 flex items-center justify-between shrink-0 select-none">
        {/* Left: Clean Project Breadcrumb & Explorer Toggle */}
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            onClick={openWorkspaceDialog}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium text-zinc-300 hover:text-white hover:bg-zinc-800/60 transition-colors cursor-pointer group shrink-0"
            title={workspaceRoot ? `${workspaceRoot} (Klasörü Değiştir)` : 'Proje Klasörü Seç'}
          >
            <FolderOpen size={14} className="text-zinc-400 group-hover:text-amber-400 transition-colors shrink-0" />
            <span className="truncate max-w-[180px]">{workspaceName || (t.agent?.openFolder || 'Proje Klasörü Aç')}</span>
          </button>

          <span className="text-zinc-700 text-xs select-none">/</span>

          <button
            onClick={() => setIsExplorerOpen(!isExplorerOpen)}
            title={isExplorerOpen ? 'Proje Gezginini Gizle' : (t.agent?.projectExplorer || 'Proje Gezginini Göster')}
            className={cn(
              'p-1.5 rounded-md text-xs transition-colors cursor-pointer',
              isExplorerOpen
                ? 'text-zinc-200 bg-zinc-800/70 hover:bg-zinc-800'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40'
            )}
          >
            <FolderTree size={13} />
          </button>

          {workspaceRoot && (
            <span
              className="text-[11px] font-mono text-zinc-600 truncate max-w-[240px] hidden sm:inline-block ml-1"
              title={workspaceRoot}
            >
              {workspaceRoot}
            </span>
          )}
        </div>

        {/* Right: Security Profile & Quiet Action Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Unified Security Profile & Sandbox Tooltip */}
          <div
            className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-900/60 border border-zinc-800/80 text-xs text-zinc-400 hover:border-zinc-700/80 transition-colors"
            title="Güvenlik Profili • Sandbox (Realpath Jail) Koruması Aktif"
          >
            <ShieldCheck
              size={13}
              className={
                settings.securityProfile === 'strict'
                  ? 'text-emerald-400'
                  : settings.securityProfile === 'balanced'
                  ? 'text-cyan-400'
                  : 'text-amber-400'
              }
            />
            <select
              value={settings.securityProfile || 'strict'}
              onChange={(e) =>
                updateSettings({ securityProfile: e.target.value as SecurityProfile })
              }
              className="bg-transparent border-0 text-[11px] text-zinc-300 focus:outline-none cursor-pointer pr-0.5"
            >
              <option value="strict" className="bg-zinc-900 text-zinc-200">
                {t.agent?.securityProfileStrict || 'Sıkı Koruma'}
              </option>
              <option value="balanced" className="bg-zinc-900 text-zinc-200">
                {t.agent?.securityProfileBalanced || 'Dengeli'}
              </option>
              <option value="autonomous" className="bg-zinc-900 text-zinc-200">
                {t.agent?.securityProfileAutonomous || 'Otonom'}
              </option>
            </select>
          </div>

          {/* Rollback Button (Conditional) */}
          {appliedTransactions.length > 0 && (
            <button
              onClick={() => rollbackAll()}
              title="Ajanın bu oturumda yaptığı tüm değişiklikleri geri alır"
              className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-900/60 border border-zinc-800 text-xs text-zinc-400 hover:text-amber-400 hover:border-amber-500/40 transition-colors cursor-pointer"
            >
              <RotateCcw size={12} />
              <span className="font-mono text-[11px]">{appliedTransactions.length}</span>
            </button>
          )}

          {/* Reasoning & Dump Panel Toggle (Linear/Cursor style PanelRight) */}
          <button
            onClick={toggleReasoningDump}
            className={cn(
              'p-1.5 rounded-md text-xs transition-colors cursor-pointer',
              showReasoningDump
                ? 'text-zinc-100 bg-zinc-800 border border-zinc-700/60 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40'
            )}
            title={
              showReasoningDump
                ? (t.agent?.hideReasoning || 'Düşünce Panelini Gizle')
                : (t.agent?.showReasoning || 'Düşünce & Muhakeme Panelini Aç')
            }
          >
            <PanelRight size={13} />
          </button>

          {/* Clear Session Button */}
          {steps.length > 0 && (
            <button
              onClick={clearSession}
              title={t.agent?.clear || 'Oturumu Temizle'}
              className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40 transition-colors cursor-pointer"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Main Workspace Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Explorer Pane */}
        {isExplorerOpen && (
          <div className="w-56 border-r border-zinc-800/60 bg-zinc-950/20 flex flex-col shrink-0 animate-in slide-in-from-left-2 duration-150">
            <div className="p-2.5 border-b border-zinc-800/40 flex items-center justify-between text-xs font-medium text-zinc-400">
              <span>{t.agent?.projectExplorer || 'Proje Gezgini'}</span>
              <span className="text-[11px] text-zinc-500">{workspaceFiles.length} Öğe</span>
            </div>

            <div className="flex-1 overflow-y-auto">
              {workspaceRoot ? (
                <FileTree
                  files={workspaceFiles}
                  onSelectFile={(path) => {
                    openFile(path);
                  }}
                  selectedFilePath={activeTabId !== 'timeline' ? activeTabId : undefined}
                />
              ) : (
                <div className="p-6 text-center text-xs text-zinc-500 space-y-3">
                  <p>Bir kod projesi üzerinde çalışmak için klasör açın.</p>
                  <button
                    onClick={openWorkspaceDialog}
                    className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium cursor-pointer transition-colors shadow-sm"
                  >
                    Klasör Seç
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Center Working Pane (Timeline or Preview) */}
        <div className="flex-1 flex flex-col overflow-hidden bg-zinc-900/10 min-w-0">
          {/* Workspace Multi-Tab Header */}
          {openFiles.length > 0 && (
            <div className="h-9 px-2 border-b border-zinc-800/60 bg-zinc-950/40 flex items-center gap-1.5 shrink-0 overflow-x-auto no-scrollbar">
              <button
                onClick={() => setActiveTabId('timeline')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors cursor-pointer border-b-2',
                  activeTabId === 'timeline'
                    ? 'bg-zinc-800/90 text-zinc-100 border-cyan-500 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200 border-transparent hover:bg-zinc-900/50'
                )}
              >
                <Activity size={12} className={activeTabId === 'timeline' ? 'text-cyan-400' : 'text-zinc-500'} />
                <span>{t.agent?.timelineTab || 'Ajan Zaman Çizelgesi'}</span>
              </button>

              {openFiles.map((file) => {
                const isActive = activeTabId === file.relativePath;
                const fileName = file.relativePath.split('/').pop() || file.relativePath;
                return (
                  <div
                    key={file.relativePath}
                    onClick={() => setActiveTabId(file.relativePath)}
                    className={cn(
                      'group flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-t-md transition-colors cursor-pointer border-b-2 max-w-[220px]',
                      isActive
                        ? 'bg-zinc-800/90 text-zinc-100 border-cyan-500 shadow-sm'
                        : 'text-zinc-400 hover:text-zinc-200 border-transparent hover:bg-zinc-900/50'
                    )}
                    title={file.relativePath}
                  >
                    <FileCode size={12} className={isActive ? 'text-cyan-400' : 'text-zinc-500'} />
                    <span className="truncate">{fileName}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        closeFileTab(file.relativePath);
                      }}
                      title={t.agent?.closeTab || 'Sekmeyi Kapat'}
                      className="p-0.5 rounded hover:bg-zinc-700/60 text-zinc-500 hover:text-zinc-200 opacity-60 group-hover:opacity-100 transition-opacity ml-1 cursor-pointer"
                    >
                      <X size={11} />
                    </button>
                  </div>
                );
              })}

              {openFiles.length > 1 && (
                <button
                  onClick={closeAllFileTabs}
                  title={t.agent?.closeAllTabs || 'Tüm Sekmeleri Kapat'}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300 px-1.5 py-0.5 ml-auto rounded hover:bg-zinc-800 transition-colors cursor-pointer shrink-0"
                >
                  ✕ {t.agent?.closeAllTabs || 'Tümünü Kapat'}
                </button>
              )}
            </div>
          )}

          {/* Tab View: File Preview or Agent Timeline */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {activeTabId !== 'timeline' && openFiles.find((f) => f.relativePath === activeTabId) ? (
              (() => {
                const currentOpenFile = openFiles.find((f) => f.relativePath === activeTabId)!;
                return (
                  <div className="h-full flex flex-col">
                    <div className="flex items-center justify-between pb-2 border-b border-zinc-800 text-xs font-mono text-zinc-400">
                      <span className="text-zinc-200 font-medium">{currentOpenFile.relativePath}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-zinc-500">Hash: {currentOpenFile.hash.slice(0, 10)}...</span>
                        <button
                          onClick={() => closeFileTab(currentOpenFile.relativePath)}
                          className="px-2 py-0.5 rounded text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors cursor-pointer"
                        >
                          {t.agent?.closeTab || 'Kapat'} ✕
                        </button>
                      </div>
                    </div>
                    <div className="flex-1 p-3 bg-zinc-950 rounded border border-zinc-800 font-mono text-xs overflow-auto select-text leading-relaxed mt-2 whitespace-pre">
                      {tokenizeCode(
                        currentOpenFile.content,
                        currentOpenFile.relativePath.split('.').pop() || 'ts'
                      ).map((token, idx) => (
                        <span key={idx} className={getTokenClassName(token.type)}>
                          {token.value}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })()
            ) : (
              /* Agent Timeline */
              <div className="max-w-3xl mx-auto space-y-3 pb-4 h-full flex flex-col">
                {steps.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-8 text-center select-none max-w-md mx-auto my-auto py-16 animate-in fade-in duration-300">
                    <div className="mb-4">
                      <AppLogo size={42} />
                    </div>
                    <h3 className="text-sm font-semibold text-zinc-100 mb-1.5 tracking-tight">
                      {t.agent?.title || 'Emir Code: Otonom Güvenli Kodlama Ajanı'}
                    </h3>
                    <p className="text-xs text-zinc-400 max-w-sm leading-relaxed mb-5">
                      {t.agent?.description ||
                        'Yapılacak bir görevi (hata düzeltme, yeni özellik, refactor) belirtin. Ajan ilgili kodları okur, diff hazırlar ve onayınız olmadan diske dokunmaz.'}
                    </p>
                    {!workspaceRoot && (
                      <button
                        onClick={openWorkspaceDialog}
                        className="px-3.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium cursor-pointer transition-colors shadow-sm flex items-center gap-2"
                      >
                        <FolderOpen size={14} />
                        <span>{t.agent?.openFolder || 'Proje Klasörü Aç'}</span>
                      </button>
                    )}
                  </div>
                ) : (
                  steps.map((step) => {
                    if (step.type === 'thought') {
                      return (
                        <div
                          key={step.id}
                          className="p-3 rounded-lg bg-zinc-900/40 border border-zinc-800/70 text-xs text-zinc-300 space-y-1.5"
                        >
                          <div className="flex items-center justify-between text-[11px] text-zinc-400">
                            <div className="flex items-center gap-1.5 font-medium">
                              <Brain size={12} className="text-zinc-400" />
                              <span>Muhakeme</span>
                            </div>
                            <span className="text-zinc-600 font-mono text-[10px]">
                              {new Date(step.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                          </div>
                          <p className="text-zinc-300 leading-relaxed select-text whitespace-pre-wrap font-sans text-xs">
                            {step.content}
                          </p>
                        </div>
                      );
                    }

                    if (step.type === 'tool_call') {
                      return (
                        <div
                          key={step.id}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-950/60 border border-zinc-800/70 text-xs text-zinc-400"
                        >
                          <Terminal size={13} className="text-zinc-400 shrink-0" />
                          <span className="font-mono text-zinc-300 font-medium">{step.toolName}</span>
                          <span className="text-zinc-600">→</span>
                          <span className="truncate font-mono text-[11px] text-zinc-400">{step.content}</span>
                        </div>
                      );
                    }

                    if (step.type === 'tool_result') {
                      return (
                        <div
                          key={step.id}
                          className={cn(
                            'flex items-start gap-2 px-3 py-2 rounded-lg text-xs border leading-relaxed',
                            step.status === 'success'
                              ? 'bg-zinc-900/30 border-zinc-800/70 text-zinc-300'
                              : step.status === 'rejected'
                              ? 'bg-amber-950/15 border-amber-900/30 text-amber-300/90'
                              : 'bg-red-950/15 border-red-900/30 text-red-300/90'
                          )}
                        >
                          {step.status === 'success' ? (
                            <CheckCircle2 size={13} className="shrink-0 mt-0.5 text-emerald-400/80" />
                          ) : (
                            <AlertCircle size={13} className="shrink-0 mt-0.5 text-amber-400/80" />
                          )}
                          <span className="select-text whitespace-pre-wrap break-all font-mono text-[11px]">
                            {step.content}
                          </span>
                        </div>
                      );
                    }

                    if (step.type === 'user_steering') {
                      return (
                        <div
                          key={step.id}
                          className="p-3 rounded-lg bg-amber-950/20 border border-amber-500/40 text-xs text-amber-200 space-y-1.5 shadow-sm animate-in fade-in duration-200"
                        >
                          <div className="flex items-center justify-between text-[11px] text-amber-400">
                            <div className="flex items-center gap-1.5 font-medium">
                              <Zap size={12} className="text-amber-400 fill-amber-400/40" />
                              <span>{step.title || t.agent?.userIntervention || 'Kullanıcı Müdahalesi (Araya Girildi)'}</span>
                            </div>
                            <span className="text-amber-500/70 font-mono text-[10px]">
                              {new Date(step.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                          </div>
                          <p className="text-zinc-100 font-medium leading-relaxed select-text whitespace-pre-wrap font-sans text-xs">
                            {step.content}
                          </p>
                        </div>
                      );
                    }

                    if (step.type === 'final_answer') {
                      return (
                        <div
                          key={step.id}
                          className="p-3.5 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-xs text-zinc-100 space-y-2 shadow-sm"
                        >
                          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
                            <CheckCircle2 size={15} />
                            <span>{step.title || 'Görev Tamamlandı'}</span>
                          </div>
                          <div className="text-zinc-200 select-text leading-relaxed whitespace-pre-wrap">
                            {step.content}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={step.id} className="text-xs text-zinc-400 italic">
                        {step.content}
                      </div>
                    );
                  })
                )}

                {/* INLINE CLARIFICATION QUESTION CARD */}
                {pendingQuestion && (
                  <div className="p-3.5 rounded-lg bg-zinc-900/80 border border-zinc-700/80 text-xs text-zinc-100 space-y-2.5 shadow-sm animate-in fade-in-50 duration-200 my-2">
                    <div className="flex items-center gap-2 text-zinc-300 font-medium text-xs">
                      <HelpCircle size={14} className="text-zinc-400 shrink-0" />
                      <span>{t.agent?.clarificationNeeded || 'Ajan Bir Kararda Size Danışıyor'}</span>
                    </div>

                    <div className="p-2.5 bg-zinc-950/80 rounded-md border border-zinc-800/80 text-xs text-zinc-200 leading-relaxed font-sans">
                      {pendingQuestion.question}
                    </div>

                    {pendingQuestion.options && pendingQuestion.options.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-[11px] text-zinc-400 font-medium block">
                          Hazır Seçenekler:
                        </span>
                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                          {pendingQuestion.options.map((opt, idx) => (
                            <button
                              key={idx}
                              onClick={() => submitAnswer(opt)}
                              className="px-2.5 py-1 rounded-md border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition-colors cursor-pointer"
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Custom Answer Input */}
                    <div className="space-y-1 pt-0.5">
                      <span className="text-[11px] text-zinc-400 font-medium block">
                        Veya Özel Bir Yanıt Belirtin:
                      </span>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={customAnswerText}
                          onChange={(e) => setCustomAnswerText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && customAnswerText.trim()) {
                              submitAnswer(customAnswerText.trim());
                              setCustomAnswerText('');
                            }
                          }}
                          placeholder={
                            t.agent?.customAnswerPlaceholder ||
                            'Özel yanıtınızı buraya yazın... (Enter)'
                          }
                          className="flex-1 bg-zinc-950 border border-zinc-800 rounded-md px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-600 font-sans"
                        />
                        <button
                          disabled={!customAnswerText.trim()}
                          onClick={() => {
                            if (customAnswerText.trim()) {
                              submitAnswer(customAnswerText.trim());
                              setCustomAnswerText('');
                            }
                          }}
                          className="px-3 py-1.5 bg-zinc-100 hover:bg-white text-zinc-900 disabled:opacity-30 disabled:hover:bg-zinc-100 text-xs font-medium rounded-md flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                        >
                          <Send size={12} />
                          <span>{t.agent?.submitAnswer || 'İlet'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Collapsible Thought & Working Block */}
                {(isBusy || inlineTranscriptOpen || (steps.length > 0 && activeStreamText)) && !pendingQuestion && (
                  <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/30 overflow-hidden transition-all my-2">
                    {/* Clickable Header Bar */}
                    <button
                      type="button"
                      onClick={toggleInlineTranscript}
                      className="w-full flex items-center justify-between px-3 py-2 text-left cursor-pointer hover:bg-zinc-800/30 transition-colors select-none group"
                    >
                      <div className="flex items-center gap-2 text-xs text-zinc-300">
                        {isBusy ? (
                          <Loader2 size={13} className="animate-spin text-zinc-400 shrink-0" />
                        ) : (
                          <Brain size={13} className="text-zinc-500 shrink-0" />
                        )}
                        <span className="font-medium text-zinc-300">
                          {isBusy ? 'Düşünülüyor...' : 'Muhakeme süreci'}
                        </span>
                        {isStreamingResponse && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold bg-blue-500/20 text-blue-400 border border-blue-500/30 uppercase tracking-wider animate-pulse">
                            CANLI TOKEN AKIŞI
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-zinc-500 group-hover:text-zinc-300 transition-colors">
                        {steps.length > 0 && (
                          <span className="text-[11px] font-mono text-zinc-600">
                            {steps.length} adım
                          </span>
                        )}
                        {inlineTranscriptOpen ? (
                          <ChevronUp size={13} />
                        ) : (
                          <ChevronDown size={13} />
                        )}
                      </div>
                    </button>

                    {/* Expandable Body */}
                    {inlineTranscriptOpen && (
                      <div className="border-t border-zinc-800/50 bg-zinc-950/40 p-2.5 space-y-2">
                        {/* Live streaming text or latest thought */}
                        {activeStreamText ? (
                          <div className="p-2.5 rounded bg-zinc-950/80 border border-zinc-800/60 text-zinc-300 text-[11px] whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto select-text font-mono">
                            {activeStreamText}
                            {isStreamingResponse && (
                              <span className="inline-block w-1.5 h-3.5 bg-zinc-400 ml-0.5 animate-pulse align-middle" />
                            )}
                          </div>
                        ) : latestThought?.content ? (
                          <div className="p-2.5 rounded bg-zinc-950/80 border border-zinc-800/60 text-zinc-300 text-[11px] whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto select-text font-mono">
                            {latestThought.content}
                          </div>
                        ) : (
                          <div className="p-2 text-zinc-500 text-xs italic font-sans">
                            {isBusy ? 'Yanıt bekleniyor...' : 'Döküm bulunmuyor.'}
                          </div>
                        )}

                        {/* Recent logs */}
                        {executionLogs.length > 0 && (
                          <div className="text-[10px] text-zinc-600 space-y-0.5 max-h-20 overflow-y-auto border-t border-zinc-800/40 pt-1.5 font-mono select-text">
                            {executionLogs.slice(-4).map((log, idx) => (
                              <div key={idx} className="truncate hover:text-zinc-400">
                                • {log}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Goal Composer Input Bar (Consistent with Chat Composer Identity) */}
          <div className="p-4 bg-transparent shrink-0">
            <div
              className={cn(
                'max-w-3xl mx-auto rounded-xl border bg-zinc-900/90 shadow-sm overflow-hidden transition-all duration-150',
                'border-zinc-800/40 focus-within:border-zinc-700/60 focus-within:ring-1 focus-within:ring-zinc-700/30'
              )}
            >
              {/* Input area */}
              <div className="flex items-end px-3 py-2 gap-2">
                {/* Project Folder / Workspace Action Button */}
                <button
                  type="button"
                  onClick={openWorkspaceDialog}
                  title={
                    workspaceRoot
                      ? `Proje: ${workspaceName || workspaceRoot} (Klasörü Değiştir)`
                      : (t.agent?.openFolder || 'Proje Klasörü Aç')
                  }
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80 transition-colors cursor-pointer shrink-0 mb-0.5"
                >
                  <FolderOpen
                    size={18}
                    strokeWidth={1.5}
                    className={workspaceRoot ? 'text-amber-400' : 'text-zinc-400'}
                  />
                </button>

                {/* Multiline auto-resizing textarea */}
                <textarea
                  ref={textareaRef}
                  value={goalInput}
                  onChange={(e) => setGoalInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (settings.sendOnEnter ? !e.shiftKey : e.ctrlKey) {
                        e.preventDefault();
                        handleStart();
                      }
                    }
                  }}
                  rows={1}
                  disabled={!workspaceRoot}
                  placeholder={
                    !workspaceRoot
                      ? (t.agent?.noFolderSelected || 'Ajanı çalıştırmak için önce yukarıdan bir proje klasörü açın.')
                      : isBusy
                      ? (t.agent?.interruptPlaceholder || 'Ajan çalışıyor... Araya girip yeni talimat vermek için buraya yazın (Enter)...')
                      : (t.agent?.inputPlaceholder || 'Ajan için bir hedef yazın... (Göndermek için Enter, yeni satır için Shift+Enter)')
                  }
                  className="flex-1 bg-transparent border-0 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-0 resize-none max-h-44 py-1.5 leading-relaxed font-sans selectable-text"
                />

                {/* Send / Stop / Interrupt Actions */}
                {isBusy ? (
                  <div className="flex items-center gap-1.5 mb-0.5 shrink-0">
                    {goalInput.trim() && (
                      <button
                        type="button"
                        onClick={handleInterrupt}
                        title={t.agent?.interruptAndSteer || 'Araya Gir & Yönlendir (Enter)'}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-medium text-xs transition-colors cursor-pointer shadow-sm animate-in fade-in"
                      >
                        <Zap size={14} className="fill-zinc-950" />
                        <span className="hidden sm:inline font-semibold">{t.agent?.interruptAndSteer || 'Araya Gir'}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={stopGoal}
                      title={t.agent?.stop || 'Durdur (Görevi İptal Et)'}
                      className="p-1.5 rounded-lg bg-red-600/90 hover:bg-red-500 text-white transition-colors cursor-pointer shadow-sm"
                    >
                      <Square size={16} strokeWidth={2} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleStart}
                    disabled={!workspaceRoot || !goalInput.trim()}
                    title={t.agent?.start || 'Başlat'}
                    className="p-1.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-900 disabled:opacity-30 disabled:hover:bg-zinc-100 transition-colors cursor-pointer shrink-0 mb-0.5 shadow-sm"
                  >
                    <ArrowUp size={16} strokeWidth={2} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT OPTIONAL REASONING & EXECUTION DUMP PANEL */}
        {showReasoningDump && (
          <div className="w-80 border-l border-zinc-800/70 bg-zinc-950/70 flex flex-col shrink-0 animate-in slide-in-from-right-3 duration-150">
            {/* Dump Header */}
            <div className="p-2.5 border-b border-zinc-800/60 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
                <Brain size={13} className="text-zinc-400" />
                <span>{t.agent?.reasoningTrace || 'Muhakeme & Döküm'}</span>
              </div>
              <button
                onClick={toggleReasoningDump}
                className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40 transition-colors cursor-pointer"
                title="Paneli Kapat"
              >
                <X size={12} />
              </button>
            </div>

            {/* Dump Sub-Tabs */}
            <div className="flex border-b border-zinc-800/60 bg-zinc-950/40 text-[11px] font-medium text-zinc-400">
              <button
                onClick={() => setDumpTab('reasoning')}
                className={cn(
                  'flex-1 py-1.5 text-center cursor-pointer transition-colors border-b-2',
                  dumpTab === 'reasoning'
                    ? 'border-zinc-300 text-zinc-100 bg-zinc-900/40'
                    : 'border-transparent hover:text-zinc-200'
                )}
              >
                Düşünce
              </button>
              <button
                onClick={() => setDumpTab('logs')}
                className={cn(
                  'flex-1 py-1.5 text-center cursor-pointer transition-colors border-b-2',
                  dumpTab === 'logs'
                    ? 'border-zinc-300 text-zinc-100 bg-zinc-900/40'
                    : 'border-transparent hover:text-zinc-200'
                )}
              >
                Loglar ({executionLogs.length})
              </button>
              <button
                onClick={() => setDumpTab('raw')}
                className={cn(
                  'flex-1 py-1.5 text-center cursor-pointer transition-colors border-b-2',
                  dumpTab === 'raw'
                    ? 'border-zinc-300 text-zinc-100 bg-zinc-900/40'
                    : 'border-transparent hover:text-zinc-200'
                )}
              >
                Ham Döküm
              </button>
            </div>

            {/* Dump Body Content */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3 font-mono text-xs">
              {dumpTab === 'reasoning' && (
                <div className="space-y-3">
                  {thoughts.length === 0 ? (
                    <div className="p-4 text-center text-zinc-500 font-sans text-xs">
                      {t.agent?.reasoningEmpty || 'Henüz muhakeme dökümü yok.'}
                    </div>
                  ) : (
                    thoughts.map((th, idx) => (
                      <div
                        key={th.id}
                        className="p-2.5 rounded-md bg-zinc-900/40 border border-zinc-800/70 space-y-1"
                      >
                        <div className="flex items-center justify-between text-[10px] text-zinc-400 font-sans">
                          <span className="font-medium">Adım #{idx + 1} Muhakemesi</span>
                          <span className="text-zinc-600 font-mono text-[10px]">
                            {new Date(th.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-zinc-300 text-[11px] leading-relaxed whitespace-pre-wrap font-mono">
                          {th.content}
                        </p>
                      </div>
                    ))
                  )}

                  {isStreamingResponse && activeStreamText && (
                    <div className="p-2.5 rounded-md bg-zinc-900/70 border border-zinc-700/80 space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-zinc-300 font-sans">
                        <span className="font-medium flex items-center gap-1.5">
                          <Loader2 size={10} className="animate-spin text-zinc-400" />
                          Aktif Muhakeme
                        </span>
                        <span className="text-zinc-500 font-mono text-[9px]">akış</span>
                      </div>
                      <p className="text-zinc-200 text-[11px] leading-relaxed whitespace-pre-wrap font-mono">
                        {activeStreamText}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {dumpTab === 'logs' && (
                <div className="space-y-1 text-[11px] leading-relaxed select-text">
                  {executionLogs.length === 0 ? (
                    <div className="p-4 text-center text-zinc-500 font-sans">Henüz log yok.</div>
                  ) : (
                    executionLogs.map((log, idx) => (
                      <div key={idx} className="text-zinc-400 hover:text-zinc-200">
                        {log}
                      </div>
                    ))
                  )}
                </div>
              )}

              {dumpTab === 'raw' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-zinc-400 font-sans">
                    <span>{isStreamingResponse ? 'Canlı Model Akışı:' : 'Son Adım Ham LLM Çıktısı:'}</span>
                    {isStreamingResponse && (
                      <span className="text-[10px] text-zinc-400 font-mono">akış</span>
                    )}
                  </div>
                  <pre className="p-2.5 bg-zinc-950 rounded-md border border-zinc-800/80 text-[11px] text-zinc-300 overflow-x-auto whitespace-pre-wrap select-text font-mono">
                    {activeStreamText ||
                      latestThought?.rawOutput ||
                      steps[steps.length - 1]?.rawOutput ||
                      '(Ham çıktı henüz üretilmedi)'}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Security Approval Modals (Diff review, Delete warning, Command approval) */}
      <ChangesetModal />
      <DeleteApprovalModal />
      <CommandApprovalModal />
    </div>
  );
};
