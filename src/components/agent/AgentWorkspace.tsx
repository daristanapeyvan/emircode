import React, { useState, useEffect, useRef } from 'react';
import { Select } from '@/components/common/Select';
import { useAgentStore } from '@/stores/agentStore';
import { FileTree } from './FileTree';
import { ChangesetModal } from './ChangesetModal';
import { DeleteApprovalModal } from './DeleteApprovalModal';
import { CommandApprovalModal } from './CommandApprovalModal';
import { SiteWizard } from './wizard/SiteWizard';
import { ToolWizard } from './wizard/ToolWizard';
import { WebsiteIcon } from './wizard/WebsiteIcon';
import { MiniAppIcon, ScriptIcon } from './wizard/ToolIcons';
import { countFiles } from './wizard/StepSummary';
import { inputClass } from './wizard/wizardUi';
import { compactPath } from '@/lib/utils/projects';
import { confirmDialog } from '@/lib/ui/dialogs';
import { useSiteWizardStore } from '@/stores/siteWizardStore';
import { useToolWizardStore } from '@/stores/toolWizardStore';
import { composerRunOptions, WizardDraft } from '@/lib/wizard/composer';
import {
  FolderOpen,
  FolderTree,
  Square,
  RotateCcw,
  Globe,
  FileCode,
  CheckCircle2,
  AlertCircle,
  Loader2,
  PanelRight,
  Trash2,
  FolderPlus,
  Check,
  Circle,
  Pause,
  ChevronDown,
  ChevronRight,
  X,
  ArrowUp,
  Code2,
} from 'lucide-react';
import { Button } from '../common/Button';
import { StartIcon } from '../common/StartIcon';
import { IconButton } from '../common/IconButton';
import { Tabs } from '../common/Tabs';
import { useUIStore } from '@/stores/uiStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations, Translations } from '@/lib/localization/i18n';
import { cn } from '@/lib/utils/cn';
import { SecurityProfile, DEFAULT_SETTINGS } from '@/types/settings';
import { tokenizeCode, getTokenClassName } from '@/lib/utils/SyntaxHighlighter';
import { cleanChatContent, cleanThoughtContent } from '@/lib/web/WebIntentDetector';

type ActionLabels = Translations['agent']['actionLabels'];

/** Decodes a (possibly unterminated) JSON string body such as the streaming "thought" value. */
function decodePartialJsonString(body: string): string {
  return body
    .replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\(["\\/bfnrt])/g, (_m, c) => ({ b: '\b', f: '\f', n: '\n', r: '', t: '\t' } as Record<string, string>)[c] ?? c)
    .replace(/\\$/, '');
}

/** The tool a streaming step is about to call, named in the interface language. */
function actionLabel(action: string, labels: ActionLabels): string {
  switch (action) {
    case 'propose_edit':
    case 'edit_file':
    case 'replace_lines':
      return labels.edit;
    case 'propose_create':
    case 'write_file':
      return labels.write;
    case 'propose_delete':
    case 'delete_file':
      return labels.delete;
    case 'read_file':
      return labels.read;
    case 'read_directory':
    case 'list_dir':
      return labels.list;
    case 'search_code':
      return labels.search;
    case 'web_search':
      return labels.webSearch;
    case 'fetch_url':
      return labels.fetch;
    case 'propose_command':
    case 'run_command':
      return labels.command;
    case 'git_status':
    case 'git_diff':
      return labels.git;
    case 'finish':
      return labels.finish;
    case 'ask_question':
    case 'ask_user':
      return labels.ask;
    default:
      return action;
  }
}

function parseAgentStream(rawText: string) {
  if (!rawText) return { thought: '', action: '', actionTarget: '', isGeneratingAction: false };

  // Reasoning tokens of thinking models are streamed first as "<think>..."
  if (rawText.startsWith('<think>')) {
    return {
      thought: rawText.slice('<think>'.length).trim().slice(-1500),
      action: '',
      actionTarget: '',
      isGeneratingAction: false,
    };
  }

  // 1. Extract thought (structured JSON output first, legacy <thought> tags second)
  let thought = '';
  const jsonThought = rawText.match(/^\s*\{\s*"thought"\s*:\s*"((?:[^"\\]|\\.)*)/);
  const thoughtMatch = rawText.match(/<thought>([\s\S]*?)(?:<\/thought>|$)/i);
  if (jsonThought) {
    thought = decodePartialJsonString(jsonThought[1]).trim();
  } else if (thoughtMatch) {
    thought = thoughtMatch[1].trim();
  } else {
    const jsonIdx = rawText.search(/```(?:json)?|\{\s*"action"/i);
    if (jsonIdx > 0) {
      thought = rawText.slice(0, jsonIdx).trim();
    } else if (jsonIdx === -1) {
      thought = rawText.trim();
    }
  }

  thought = cleanThoughtContent(thought);

  // 2. Extract action info
  const actionMatch = rawText.match(/"action"\s*:\s*"([^"]+)"/i);
  const pathMatch = rawText.match(/"path"\s*:\s*"([^"]+)"/i);
  const queryMatch = rawText.match(/"query"\s*:\s*"([^"]+)"/i);
  const urlMatch = rawText.match(/"url"\s*:\s*"([^"]+)"/i);

  const action = actionMatch ? actionMatch[1] : '';
  const actionTarget = pathMatch ? pathMatch[1] : (queryMatch ? queryMatch[1] : (urlMatch ? urlMatch[1] : ''));
  const isGeneratingAction = !!action || /```(?:json)?|\{\s*"action"/i.test(rawText);

  return { thought, action, actionTarget, isGeneratingAction };
}

/** The request a generator (site wizard) prepared for the agent, collapsed by default. */
const GeneratedRequestCard: React.FC<{ title: string; content: string }> = ({ title, content }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-left text-zinc-500 hover:text-zinc-200 transition-colors cursor-pointer"
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <FileCode size={13} />
        <span>{title}</span>
      </button>
      {open && (
        <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-zinc-950 border border-zinc-800 p-3 text-[11px] leading-relaxed text-zinc-300 whitespace-pre-wrap font-mono select-text">
          {content}
        </pre>
      )}
    </div>
  );
};

const tabClass = (active: boolean) =>
  cn(
    '-mb-px px-3 py-1.5 text-xs font-medium border-b-2 transition-colors cursor-pointer',
    active ? 'text-zinc-100 border-zinc-300' : 'text-zinc-400 border-transparent hover:text-zinc-200'
  );

export const AgentWorkspace: React.FC = () => {
  const {
    workspaceRoot,
    workspaceName,
    workspaceFiles,
    openFiles,
    activeTabId,
    agentStatus,
    taskStartTime,
    subtasks,
    steps,
    executionLogs,
    appliedTransactions,
    showReasoningDump,
    activeStreamText,
    isStreamingResponse,
    inlineTranscriptOpen,
    pendingQuestion,
    toggleReasoningDump,
    toggleInlineTranscript,
    init,
    openWorkspaceDialog,
    refreshFiles,
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
    wizardDraft,
    clearWizardDraft,
    confirmLeaveRunningTask,
    openExistingProject,
  } = useAgentStore();
  const openNewProject = useUIStore((s) => s.openNewProject);

  const { settings, updateSettings, setWebAccess } = useSettingsStore();
  const t = getTranslations(settings.language);

  const [goalInput, setGoalInput] = useState('');
  const goalInputRef = useRef(goalInput);
  goalInputRef.current = goalInput;
  /** The wizard request currently shown in the composer. */
  const appliedDraft = useRef<WizardDraft | null>(null);
  const [customAnswerText, setCustomAnswerText] = useState('');
  const isExplorerOpen = useUIStore((s) => s.isExplorerOpen);
  const setExplorerOpen = useUIStore((s) => s.setExplorerOpen);
  const [dumpTab, setDumpTab] = useState<'logs' | 'raw'>('logs');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isBusy = agentStatus === 'thinking' || agentStatus === 'running_command';

  useEffect(() => {
    if (!taskStartTime || !isBusy) {
      setElapsedSeconds(0);
      return;
    }
    const updateElapsed = () => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - taskStartTime) / 1000)));
    };
    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [taskStartTime, isBusy]);

  const formatElapsed = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  useEffect(() => {
    init();
  }, []);

  // Auto-resize textarea height (a long wizard request gets more room to be read and edited)
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      const limit = wizardDraft ? Math.min(440, Math.round(window.innerHeight * 0.45)) : 180;
      textareaRef.current.style.height = `${Math.min(scrollHeight, limit)}px`;
    }
  }, [goalInput, wizardDraft]);

  // A wizard was confirmed: its request goes into the composer; the user reads, edits and sends it.
  useEffect(() => {
    if (!wizardDraft) {
      appliedDraft.current = null;
      return;
    }
    if (appliedDraft.current?.nonce === wizardDraft.nonce) return;
    const previous = appliedDraft.current;
    const text = goalInputRef.current;
    const ownText = text.trim() !== '' && text !== previous?.prompt && text !== wizardDraft.prompt;
    const apply = () => {
      appliedDraft.current = wizardDraft;
      setGoalInput(wizardDraft.prompt);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(0, 0);
        el.scrollTop = 0;
      });
    };
    if (!ownText) {
      apply();
      return;
    }
    void confirmDialog({ title: t.toolWizard.replaceTitle, message: t.toolWizard.replaceConfirm, confirmLabel: t.toolWizard.replaceAction }).then((replace) => {
      if (replace) apply();
      // Keep the user's text together with the request it belonged to.
      else useAgentStore.setState({ wizardDraft: previous });
    });
  }, [wizardDraft]);

  const openDraftWizard = () => {
    if (!wizardDraft) return;
    if (wizardDraft.kind === 'site') useSiteWizardStore.getState().openWizard();
    else useToolWizardStore.getState().openWizard(wizardDraft.kind, wizardDraft.toolId);
  };

  const removeDraft = () => {
    clearWizardDraft();
    setGoalInput('');
  };

  const timelineEndRef = useRef<HTMLDivElement>(null);
  const [creatingFolderIn, setCreatingFolderIn] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');

  // Auto-scroll timeline smoothly on updates
  useEffect(() => {
    if (activeTabId === 'timeline') {
      timelineEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [steps.length, activeStreamText, pendingQuestion, activeTabId]);

  const handleStartCreateFolder = (parentPath: string) => {
    setCreatingFolderIn(parentPath);
    setNewFolderName('');
  };

  const handleConfirmCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name || creatingFolderIn === null) {
      setCreatingFolderIn(null);
      return;
    }
    const fullRelPath = creatingFolderIn ? `${creatingFolderIn}/${name}` : name;
    if (window.electronAPI?.createWorkspaceDirectory) {
      const res = await window.electronAPI.createWorkspaceDirectory(fullRelPath);
      if (res.success) {
        await refreshFiles();
      }
    }
    setCreatingFolderIn(null);
    setNewFolderName('');
  };

  const handleDeleteItem = async (relativePath: string, isDirectory: boolean) => {
    const name = relativePath.split('/').pop() || relativePath;
    const confirmMsg = (isDirectory ? t.agent.deleteFolderConfirm : t.agent.deleteFileConfirm).replace('{name}', name);

    const confirmed = await confirmDialog({
      title: isDirectory ? t.agent.deleteFolder : t.agent.deleteFile,
      message: confirmMsg,
      confirmLabel: t.common.delete,
      danger: true,
    });
    if (confirmed) {
      if (window.electronAPI?.deleteWorkspaceItem) {
        const res = await window.electronAPI.deleteWorkspaceItem(relativePath);
        if (res.success) {
          closeFileTab(relativePath);
          await refreshFiles();
        }
      }
    }
  };

  const handleRollback = async () => {
    const count = appliedTransactions.length;
    if (
      settings.confirmDestructive &&
      !(await confirmDialog({
        title: t.agent.rollbackTitle,
        message: t.agent.rollbackConfirm.replace('{count}', String(count)),
        confirmLabel: t.agent.rollbackAction,
        danger: true,
      }))
    )
      return;
    rollbackAll();
  };

  const resetComposer = () => {
    setGoalInput('');
    clearWizardDraft();
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleInterrupt = () => {
    if (!goalInput.trim()) return;
    const text = goalInput.trim();
    resetComposer();
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
    // A wizard's request keeps its title, plan, theme and checks even after the user edited it.
    const options = composerRunOptions(wizardDraft, textToSend);
    resetComposer();
    startGoal(textToSend, options);
  };

  const submitCustomAnswer = () => {
    const answer = customAnswerText.trim();
    if (!answer) return;
    submitAnswer(answer);
    setCustomAnswerText('');
  };

  const securityProfile = settings.securityProfile || 'strict';
  const securityHint =
    securityProfile === 'autonomous'
      ? t.agent.securityHintAutonomous
      : securityProfile === 'balanced'
      ? t.agent.securityHintBalanced
      : t.agent.securityHintStrict;

  const webAccess = settings.webAccess || DEFAULT_SETTINGS.webAccess;
  const webOn = webAccess.enabled && webAccess.codingEnabled;

  const timeOf = (timestamp: number) =>
    new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const streamParsed = activeStreamText ? parseAgentStream(activeStreamText) : null;
  const fileCount = countFiles(workspaceFiles || []);

  const currentFile = activeTabId !== 'timeline' ? openFiles.find((f) => f.relativePath === activeTabId) : undefined;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-canvas text-zinc-200">
      {/* Project bar: name (click: change folder) · approval level · panels */}
      {(workspaceRoot || steps.length > 0) && (
        <div className="h-9 px-3 border-b border-zinc-800 flex items-center justify-between gap-3 shrink-0 select-none">
          <button
            type="button"
            onClick={openWorkspaceDialog}
            className="-ml-2 flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium text-zinc-200 hover:bg-zinc-800/60 transition-colors cursor-pointer min-w-0"
            title={workspaceRoot ? `${workspaceRoot}\n${t.agent.changeFolder}` : t.agent.openFolder}
          >
            <FolderOpen size={14} strokeWidth={1.5} className="text-zinc-500 shrink-0" />
            <span className="truncate max-w-[260px]">{workspaceName || t.agent.openFolder}</span>
          </button>

          <div className="flex items-center gap-1 shrink-0">
            <div className="flex items-center gap-1.5 mr-1 text-xs text-zinc-500" title={securityHint}>
              {t.agent.approvalLabel}
              <Select
                variant="bare"
                ariaLabel={t.settings.securityProfile}
                value={securityProfile}
                onChange={(v) => updateSettings({ securityProfile: v as SecurityProfile })}
                options={[
                  { value: 'strict', label: t.agent.securityProfileStrict },
                  { value: 'balanced', label: t.agent.securityProfileBalanced },
                  { value: 'autonomous', label: t.agent.securityProfileAutonomous },
                ]}
              />
            </div>

            {appliedTransactions.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                icon={<RotateCcw size={12} strokeWidth={1.5} />}
                onClick={handleRollback}
                title={t.agent.rollbackAllTooltip}
              >
                {t.agent.rollbackButton.replace('{count}', String(appliedTransactions.length))}
              </Button>
            )}

            <IconButton
              label={isExplorerOpen ? t.agent.hideExplorer : t.agent.showExplorer}
              icon={<FolderTree size={14} strokeWidth={1.5} />}
              size="sm"
              aria-pressed={isExplorerOpen}
              className={cn(isExplorerOpen && 'bg-zinc-800 text-zinc-100')}
              onClick={() => setExplorerOpen(!isExplorerOpen)}
            />
            <IconButton
              label={showReasoningDump ? t.agent.hideReasoning : t.agent.showReasoning}
              icon={<PanelRight size={14} strokeWidth={1.5} />}
              size="sm"
              aria-pressed={showReasoningDump}
              className={cn(showReasoningDump && 'bg-zinc-800 text-zinc-100')}
              onClick={toggleReasoningDump}
            />
            {steps.length > 0 && (
              <IconButton
                label={t.agent.clear}
                icon={<Trash2 size={14} strokeWidth={1.5} />}
                size="sm"
                onClick={async () => (await confirmLeaveRunningTask()) && clearSession()}
              />
            )}
          </div>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Files */}
        {isExplorerOpen && (
          <div className="w-56 border-r border-zinc-800 flex flex-col shrink-0">
            <div className="h-9 px-3 border-b border-zinc-800 flex items-center justify-between text-xs">
              <span className="font-medium text-zinc-300">{t.agent.projectExplorer}</span>
              {workspaceRoot && (
                <IconButton
                  label={t.agent.newFolder}
                  icon={<FolderPlus size={13} strokeWidth={1.5} />}
                  size="sm"
                  onClick={() => handleStartCreateFolder('')}
                />
              )}
            </div>

            {creatingFolderIn !== null && (
              <div className="px-2 py-1.5 border-b border-zinc-800 flex items-center gap-1">
                <input
                  autoFocus
                  type="text"
                  placeholder={t.agent.folderNamePlaceholder}
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleConfirmCreateFolder();
                    if (e.key === 'Escape') setCreatingFolderIn(null);
                  }}
                  className="flex-1 min-w-0 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500 font-mono"
                />
                <IconButton label={t.agent.confirmEnter} icon={<Check size={12} />} size="sm" onClick={handleConfirmCreateFolder} />
                <IconButton label={t.agent.cancelEsc} icon={<X size={12} />} size="sm" onClick={() => setCreatingFolderIn(null)} />
              </div>
            )}

            <div className="flex-1 overflow-y-auto">
              {workspaceRoot ? (
                <FileTree
                  files={workspaceFiles}
                  onSelectFile={(path) => {
                    openFile(path);
                  }}
                  selectedFilePath={activeTabId !== 'timeline' ? activeTabId : undefined}
                  onDeleteFile={(path, isDir) => handleDeleteItem(path, isDir)}
                  onCreateFolder={(parentPath) => handleStartCreateFolder(parentPath)}
                />
              ) : (
                <div className="p-5 text-center text-xs text-zinc-500 space-y-3">
                  <p>{t.agent.openFolderToWork}</p>
                  <Button variant="primary" size="sm" onClick={openWorkspaceDialog}>
                    {t.agent.selectFolder}
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Task and open files */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {openFiles.length > 0 && (
            <div className="h-9 px-2 border-b border-zinc-800 flex items-end gap-0.5 shrink-0 overflow-x-auto">
              <button type="button" onClick={() => setActiveTabId('timeline')} className={tabClass(activeTabId === 'timeline')}>
                {t.agent.timelineTab}
              </button>

              {openFiles.map((file) => {
                const isActive = activeTabId === file.relativePath;
                const fileName = file.relativePath.split('/').pop() || file.relativePath;
                return (
                  <div
                    key={file.relativePath}
                    onClick={() => setActiveTabId(file.relativePath)}
                    className={cn(tabClass(isActive), 'group flex items-center gap-1 max-w-[220px] pr-1.5')}
                    title={file.relativePath}
                  >
                    <span className="truncate">{fileName}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeFileTab(file.relativePath);
                      }}
                      title={t.agent.closeTab}
                      aria-label={t.agent.closeTab}
                      className="p-0.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 opacity-60 group-hover:opacity-100 transition-opacity cursor-pointer"
                    >
                      <X size={11} />
                    </button>
                  </div>
                );
              })}

              {openFiles.length > 1 && (
                <button
                  type="button"
                  onClick={closeAllFileTabs}
                  className="ml-auto self-center shrink-0 px-2 py-1 rounded text-[11px] text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors cursor-pointer"
                >
                  {t.agent.closeAllTabs}
                </button>
              )}
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-4 py-4">
            {currentFile ? (
              <div className="h-full flex flex-col gap-2">
                <p className="text-xs font-mono text-zinc-400 truncate" title={currentFile.relativePath}>
                  {currentFile.relativePath}
                </p>
                <div className="flex-1 p-3 bg-zinc-950 rounded-md border border-zinc-800 font-mono text-xs overflow-auto select-text leading-relaxed whitespace-pre">
                  {tokenizeCode(currentFile.content, currentFile.relativePath.split('.').pop() || 'ts').map((token, idx) => (
                    <span key={idx} className={getTokenClassName(token.type)}>
                      {token.value}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="max-w-3xl mx-auto min-h-full flex flex-col gap-3 pb-4">
                {steps.length === 0 ? (
                  !workspaceRoot ? (
                    /* No project yet: create one (New Project offers the wizards) or open a folder */
                    <div className="my-auto flex flex-col items-center gap-6 py-12 text-center select-none">
                      <StartIcon icon={<Code2 size={22} strokeWidth={1.5} />} />
                      <div className="-mt-2 space-y-1.5">
                        <h2 className="text-xl font-semibold text-zinc-100">{t.agent.startHeading}</h2>
                        <p className="text-xs text-zinc-400">{t.agent.emptyNoFolder}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="primary" icon={<FolderPlus size={14} strokeWidth={1.5} />} onClick={openNewProject}>
                          {t.projects.newProject}
                        </Button>
                        <Button variant="secondary" icon={<FolderOpen size={14} strokeWidth={1.5} />} onClick={() => openExistingProject()}>
                          {t.agent.openFolder}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    /* A project without a task yet: where it is and what is in it */
                    <div className="my-auto flex flex-col items-center gap-6 py-12 text-center select-none">
                      <StartIcon icon={<Code2 size={22} strokeWidth={1.5} />} />
                      <div className="-mt-2 space-y-1.5">
                        <h2 className="text-xl font-semibold text-zinc-100">{workspaceName}</h2>
                        <p className="text-xs text-zinc-500" title={workspaceRoot}>
                          <span className="font-mono">{compactPath(workspaceRoot, 3)}</span> ·{' '}
                          {fileCount > 0 ? t.agent.fileCount.replace('{count}', String(fileCount)) : t.agent.emptyFolderLabel}
                        </p>
                      </div>
                      <p className="text-xs text-zinc-400 max-w-md">{fileCount > 0 ? t.agent.projectHint : t.agent.emptyFolderHint}</p>
                    </div>
                  )
                ) : (
                  <>
                    {/* Plan: shown once it has more than one item */}
                    {subtasks.length > 1 && (
                      <ul className="space-y-1 text-xs select-none">
                        {subtasks.map((task, idx) => {
                          const isCompleted = task.status === 'completed';
                          const isInProgress = task.status === 'in_progress';
                          return (
                            <li
                              key={task.id || idx}
                              className={cn(
                                'flex items-start gap-2 leading-relaxed',
                                isCompleted ? 'text-zinc-500' : isInProgress ? 'text-zinc-100' : 'text-zinc-400'
                              )}
                            >
                              <span className="mt-0.5 shrink-0 w-3.5 flex justify-center">
                                {isCompleted ? (
                                  <Check size={13} strokeWidth={2} />
                                ) : isInProgress && isBusy ? (
                                  <Loader2 size={13} className="animate-spin" />
                                ) : isInProgress ? (
                                  <Pause size={12} />
                                ) : (
                                  <Circle size={11} className="text-zinc-600" />
                                )}
                              </span>
                              <span className={cn(isCompleted && 'line-through')}>{task.description}</span>
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    {steps.map((step) => {
                      if (step.type === 'thought') {
                        return (
                          <p
                            key={step.id}
                            title={timeOf(step.timestamp)}
                            className="text-xs text-zinc-400 leading-relaxed whitespace-pre-wrap select-text"
                          >
                            {cleanThoughtContent(step.content)}
                          </p>
                        );
                      }

                      if (step.type === 'tool_call') {
                        return (
                          <div key={step.id} title={timeOf(step.timestamp)} className="flex items-center gap-1.5 text-xs font-mono text-zinc-500 min-w-0">
                            <ChevronRight size={12} className="shrink-0" />
                            <span className="text-zinc-300 shrink-0">{step.toolName}</span>
                            <span className="truncate min-w-0">{step.content}</span>
                          </div>
                        );
                      }

                      if (step.type === 'tool_result') {
                        const ok = step.status === 'success';
                        return (
                          <div
                            key={step.id}
                            className={cn(
                              '-mt-2 pl-5 flex items-start gap-1.5 text-[11px] font-mono leading-relaxed min-w-0',
                              ok ? 'text-zinc-500' : step.status === 'rejected' ? 'text-amber-400/90' : 'text-red-400/90'
                            )}
                          >
                            {ok ? <Check size={12} className="shrink-0 mt-0.5" /> : <AlertCircle size={12} className="shrink-0 mt-0.5" />}
                            <span className="select-text whitespace-pre-wrap break-all max-h-48 overflow-y-auto">{step.content}</span>
                          </div>
                        );
                      }

                      if (step.type === 'user_steering') {
                        return (
                          <div key={step.id} className="rounded-md bg-zinc-800/40 px-3.5 py-2.5">
                            <p className="text-sm text-zinc-100 leading-relaxed whitespace-pre-wrap select-text">{step.content}</p>
                            <p className="mt-1 text-[11px] text-zinc-500">{t.agent.interrupted}</p>
                          </div>
                        );
                      }

                      if (step.type === 'final_answer') {
                        const incomplete = step.status === 'failed';
                        return (
                          <div key={step.id} className="rounded-md border border-zinc-800 px-3.5 py-3 space-y-1.5">
                            <p className={cn('flex items-center gap-1.5 text-xs font-medium', incomplete ? 'text-amber-400' : 'text-emerald-400')}>
                              {incomplete ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
                              {step.title || t.agent.taskCompleted}
                            </p>
                            <div className="text-xs text-zinc-200 leading-relaxed whitespace-pre-wrap select-text">{cleanChatContent(step.content)}</div>
                          </div>
                        );
                      }

                      if (step.type === 'system_notice' && step.metadata?.kind === 'generated_request') {
                        return <GeneratedRequestCard key={step.id} title={step.title || ''} content={step.content} />;
                      }

                      return (
                        <p key={step.id} title={timeOf(step.timestamp)} className="text-[11px] text-zinc-500 whitespace-pre-wrap">
                          {step.content}
                        </p>
                      );
                    })}
                  </>
                )}

                {/* The agent's question */}
                {pendingQuestion && (
                  <div className="rounded-md border border-zinc-800 p-3.5 space-y-3">
                    <p className="text-sm text-zinc-100 leading-relaxed whitespace-pre-wrap">{pendingQuestion.question}</p>

                    {pendingQuestion.options && pendingQuestion.options.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {pendingQuestion.options.map((opt, idx) => (
                          <Button key={idx} variant="secondary" size="sm" onClick={() => submitAnswer(opt)}>
                            {opt}
                          </Button>
                        ))}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={customAnswerText}
                        onChange={(e) => setCustomAnswerText(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && submitCustomAnswer()}
                        placeholder={t.agent.customAnswerPlaceholder}
                        className={cn(inputClass, 'flex-1')}
                      />
                      <Button variant="primary" disabled={!customAnswerText.trim()} onClick={submitCustomAnswer}>
                        {t.agent.submitAnswer}
                      </Button>
                    </div>
                  </div>
                )}

                {/* What the model is writing right now */}
                {(isBusy || activeStreamText) && !pendingQuestion && (
                  <div className="rounded-md border border-zinc-800 overflow-hidden">
                    <button
                      type="button"
                      onClick={toggleInlineTranscript}
                      aria-expanded={inlineTranscriptOpen}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer select-none"
                    >
                      {isBusy ? <Loader2 size={13} className="animate-spin shrink-0" /> : <ChevronRight size={13} className="shrink-0" />}
                      <span>{isBusy ? t.agent.thinking : t.agent.reasoningProcess}</span>
                      {isBusy && elapsedSeconds > 0 && (
                        <span className="tabular-nums text-zinc-500" title={t.agent.elapsedTime}>
                          {formatElapsed(elapsedSeconds)}
                        </span>
                      )}
                      <ChevronDown size={13} className={cn('ml-auto shrink-0 transition-transform', inlineTranscriptOpen && 'rotate-180')} />
                    </button>

                    {inlineTranscriptOpen && (
                      <div className="border-t border-zinc-800 px-3 py-2.5 space-y-2 max-h-56 overflow-y-auto text-[11px] leading-relaxed select-text">
                        {streamParsed?.thought && <p className="text-zinc-300 whitespace-pre-wrap">{streamParsed.thought}</p>}
                        {streamParsed?.isGeneratingAction && (
                          <p className="flex items-center gap-1.5 text-zinc-400 min-w-0">
                            {isStreamingResponse && <Loader2 size={11} className="animate-spin shrink-0" />}
                            <span className="shrink-0">
                              {streamParsed.action ? actionLabel(streamParsed.action, t.agent.actionLabels) : t.agent.preparingStep}
                            </span>
                            {streamParsed.actionTarget && <span className="font-mono text-zinc-500 truncate">{streamParsed.actionTarget}</span>}
                          </p>
                        )}
                        {!streamParsed?.thought && !streamParsed?.isGeneratingAction && <p className="text-zinc-500">{t.agent.waitingResponse}</p>}
                      </div>
                    )}
                  </div>
                )}

                <div ref={timelineEndRef} className="h-4 shrink-0" />
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="px-4 pb-4 shrink-0">
            <div className="max-w-3xl mx-auto rounded-lg border border-zinc-800 bg-zinc-900 focus-within:border-zinc-700 transition-colors">
              {/* A wizard's request waiting to be sent */}
              {wizardDraft && (
                <div className="flex items-center gap-1 p-2 border-b border-zinc-800">
                  <span className="w-8 flex justify-center text-zinc-400 shrink-0">
                    {wizardDraft.kind === 'site' ? <WebsiteIcon size={14} /> : wizardDraft.kind === 'mini' ? <MiniAppIcon size={14} /> : <ScriptIcon size={14} />}
                  </span>
                  <p className="min-w-0 flex-1 px-1.5 text-xs text-zinc-300 truncate" title={wizardDraft.label}>
                    <span className="text-zinc-500">
                      {wizardDraft.kind === 'site' ? t.toolWizard.badgeSite : wizardDraft.kind === 'mini' ? t.toolWizard.badgeMini : t.toolWizard.badgeScript}:
                    </span>{' '}
                    {wizardDraft.label}
                  </p>
                  <button
                    type="button"
                    onClick={openDraftWizard}
                    className="shrink-0 h-6 px-2 rounded text-[11px] text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 transition-colors cursor-pointer"
                  >
                    {t.toolWizard.badgeOpen}
                  </button>
                  <IconButton label={t.toolWizard.badgeRemove} icon={<X size={13} strokeWidth={1.5} />} size="sm" onClick={removeDraft} />
                </div>
              )}

              <div className="flex items-end gap-1 p-2">
                <button
                  type="button"
                  onClick={() => setWebAccess({ enabled: !webOn, codingEnabled: !webOn })}
                  title={webOn ? t.chat.webOn : t.chat.webOff}
                  aria-label={webOn ? t.chat.webOn : t.chat.webOff}
                  aria-pressed={webOn}
                  className={cn(
                    'inline-flex items-center justify-center w-8 h-8 shrink-0 rounded transition-colors cursor-pointer',
                    webOn ? 'bg-blue-500/15 text-blue-400 hover:bg-blue-500/25' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60'
                  )}
                >
                  <Globe size={16} strokeWidth={1.5} />
                </button>

                <textarea
                  ref={textareaRef}
                  data-agent-composer
                  value={goalInput}
                  // A wizard's generated request is not the user's prose: no spell-check underlines all over it.
                  spellCheck={!wizardDraft}
                  onChange={(e) => {
                    setGoalInput(e.target.value);
                    // Emptying the box drops the wizard request with it.
                    if (!e.target.value.trim() && wizardDraft) clearWizardDraft();
                  }}
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
                  placeholder={!workspaceRoot ? t.agent.noFolderSelected : isBusy ? t.agent.interruptPlaceholder : t.agent.inputPlaceholder}
                  className={cn(
                    'flex-1 min-w-0 bg-transparent border-0 px-1.5 py-1.5 text-sm leading-5 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-0 resize-none',
                    wizardDraft ? 'max-h-[45vh]' : 'max-h-44'
                  )}
                />

                {isBusy && (
                  <button
                    type="button"
                    onClick={stopGoal}
                    title={t.agent.stop}
                    aria-label={t.agent.stop}
                    className="inline-flex items-center justify-center w-8 h-8 shrink-0 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors cursor-pointer"
                  >
                    <Square size={14} strokeWidth={2} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={isBusy ? handleInterrupt : handleStart}
                  disabled={!goalInput.trim() || (!isBusy && !workspaceRoot)}
                  title={isBusy ? t.agent.interruptAndSteer : t.agent.start}
                  aria-label={isBusy ? t.agent.interruptAndSteer : t.agent.start}
                  className="inline-flex items-center justify-center w-8 h-8 shrink-0 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer"
                >
                  <ArrowUp size={16} strokeWidth={2} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Logs and the model's raw output */}
        {showReasoningDump && (
          <div className="w-80 border-l border-zinc-800 flex flex-col shrink-0">
            <div className="h-9 px-3 border-b border-zinc-800 flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-300">{t.agent.logsPanel}</span>
              <IconButton label={t.common.close} icon={<X size={13} />} size="sm" onClick={toggleReasoningDump} />
            </div>

            <Tabs
              className="px-2"
              tabs={[
                { id: 'logs', label: t.agent.logsTab },
                { id: 'raw', label: t.agent.rawDumpTab },
              ]}
              activeTab={dumpTab}
              onChange={(id) => setDumpTab(id as 'logs' | 'raw')}
            />

            <div className="flex-1 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed select-text">
              {dumpTab === 'logs' ? (
                executionLogs.length === 0 ? (
                  <p className="p-4 text-center text-zinc-500 font-sans">{t.agent.noLogs}</p>
                ) : (
                  <div className="space-y-1">
                    {executionLogs.map((log, idx) => (
                      <div key={idx} className="text-zinc-400">
                        {log}
                      </div>
                    ))}
                  </div>
                )
              ) : (
                <pre className="text-zinc-300 whitespace-pre-wrap">
                  {activeStreamText || [...steps].reverse().find((s) => s.rawOutput)?.rawOutput || t.agent.noRawOutput}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Approvals and wizards */}
      <ChangesetModal />
      <DeleteApprovalModal />
      <CommandApprovalModal />
      <SiteWizard />
      <ToolWizard />
    </div>
  );
};
