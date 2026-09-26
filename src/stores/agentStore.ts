import { confirmDialog, noticeDialog } from '@/lib/ui/dialogs';
import { create } from 'zustand';
import {
  AgentStatus,
  AgentStep,
  ChangesetItem,
  CommandApprovalItem,
  ClarificationItem,
  AppliedTransaction,
  TaskChecklistItem,
} from '@/types/agent';
import { WorkspaceFileInfo, ProjectErrorCode } from '../../electron/preload';
import { agentEngine } from '@/lib/agent/AgentEngine';
import type { WizardDraft, WizardRunOptions } from '@/lib/wizard/composer';
import { storageService } from '@/lib/storage/StorageService';
import { getTranslations } from '@/lib/localization/i18n';
import { describeProjectError, folderNameOf, projectKey } from '@/lib/utils/projects';
import { useModelStore } from './modelStore';
import { useChatStore } from './chatStore';
import { useSettingsStore } from './settingsStore';

/** Extras of a run started from a wizard (a request typed by hand sends none). */
export type StartGoalOptions = WizardRunOptions;

/** A project the New Project dialog creates once the chosen wizard is confirmed. */
export interface PendingProject {
  parentDir: string;
  name: string;
  /** Full path of the folder to be created (shown in the wizards). */
  target: string;
}

/** A run is going on or waits for the user (approval, question). */
export const isAgentBusy = (status: AgentStatus) => status !== 'idle' && status !== 'finished' && status !== 'error';

/**
 * The run whose callbacks may still change the state. Leaving a session (new task, another
 * task, another folder) stops its run; whatever the stopped run reports afterwards is dropped.
 */
let liveRunId = 0;

const projectTexts = () => getTranslations(useSettingsStore.getState().settings.language).projects;

/** Answers the approvals of a stopped run with "no" so it does not wait forever. */
function dropPendingApprovals(get: () => AgentState) {
  const { changesetResolver, deleteResolver, commandResolver, questionResolver } = get();
  changesetResolver?.(false);
  deleteResolver?.(false);
  commandResolver?.(false);
  questionResolver?.('');
}

interface AgentState {
  workspaceRoot: string | null;
  workspaceName: string | null;
  workspaceFiles: WorkspaceFileInfo[];
  activeFile: { relativePath: string; content: string; hash: string } | null;
  openFiles: Array<{ relativePath: string; content: string; hash: string }>;
  activeTabId: string;
  agentStatus: AgentStatus;
  currentGoal: string;
  taskStartTime: number | null;
  subtasks: TaskChecklistItem[];
  steps: AgentStep[];
  executionLogs: string[];
  appliedTransactions: AppliedTransaction[];
  showReasoningDump: boolean;
  activeStreamText: string;
  isStreamingResponse: boolean;
  inlineTranscriptOpen: boolean;
  /** A wizard's request waiting in the composer for the user to send (with its run options). */
  wizardDraft: WizardDraft | null;
  /** The saved task the session above belongs to (null for a new session not sent yet). */
  sessionChatId: string | null;
  pendingProject: PendingProject | null;

  // Pending user approvals
  pendingChangeset: ChangesetItem[];
  pendingDelete: ChangesetItem | null;
  pendingCommand: CommandApprovalItem | null;
  pendingQuestion: ClarificationItem | null;

  // Resolvers for asynchronous user interactions
  changesetResolver: ((value: boolean) => void) | null;
  deleteResolver: ((value: boolean) => void) | null;
  commandResolver: ((value: boolean) => void) | null;
  questionResolver: ((value: string) => void) | null;

  // Actions
  toggleReasoningDump: () => void;
  toggleInlineTranscript: () => void;
  setInlineTranscriptOpen: (open: boolean) => void;
  init: () => Promise<void>;
  persistCurrentSession: () => void;
  loadSession: (chatId: string) => Promise<void>;
  openWorkspaceDialog: () => Promise<void>;
  refreshFiles: () => Promise<void>;
  openFile: (relativePath: string) => Promise<void>;
  closeFileTab: (relativePath: string) => void;
  closeAllFileTabs: () => void;
  setActiveTabId: (id: string) => void;
  closeFile: () => void;

  startGoal: (goal: string, options?: StartGoalOptions) => Promise<void>;
  /** Puts a wizard's request into the composer; nothing starts until the user sends it. */
  setWizardDraft: (draft: Omit<WizardDraft, 'nonce'>) => void;
  clearWizardDraft: () => void;
  stopGoal: () => void;
  interruptGoal: (directive: string) => void;
  /** Starts an empty session (in the open folder); a running task is stopped. */
  clearSession: () => void;

  // Projects (the sidebar groups tasks by folder)
  /** Asks before leaving a running task and stops it when the user agrees. */
  confirmLeaveRunningTask: () => Promise<boolean>;
  /** Makes the folder the open workspace (the main process has already switched to it). */
  activateWorkspace: (rootPath: string, folderName?: string) => Promise<void>;
  /** An empty session in the given folder (the "+" of a project in the sidebar, Ctrl+N). */
  startTaskInFolder: (root: string) => Promise<boolean>;
  /** Creates the project folder, opens it and starts an empty session there. */
  createProject: (parentDir: string, name: string) => Promise<{ success: boolean; code?: ProjectErrorCode; error?: string }>;
  setPendingProject: (project: PendingProject | null) => void;
  /** Creates the pending project; the wizards call it on confirm. False when it failed. */
  createPendingProject: () => Promise<boolean>;
  /** The native folder picker; the chosen folder opens with an empty session. */
  openExistingProject: () => Promise<boolean>;

  // Changeset Actions
  setPendingChangeset: (items: ChangesetItem[], resolver: (value: boolean) => void) => void;
  toggleChangesetItem: (id: string) => void;
  selectAllChangeset: (selected: boolean) => void;
  approveSelectedChangeset: () => Promise<void>;
  rejectChangeset: () => void;

  // Delete Actions
  setPendingDelete: (item: ChangesetItem, resolver: (value: boolean) => void) => void;
  approveDelete: () => Promise<void>;
  rejectDelete: () => void;

  // Command Actions
  setPendingCommand: (item: CommandApprovalItem, resolver: (value: boolean) => void) => void;
  approveCommand: () => Promise<void>;
  rejectCommand: () => void;

  // Clarification Actions
  setPendingQuestion: (item: ClarificationItem, resolver: (value: string) => void) => void;
  submitAnswer: (answer: string) => void;

  // Rollback Actions
  rollbackTransaction: (txId: string, force?: boolean) => Promise<{ success: boolean; conflict?: boolean; error?: string }>;
  rollbackAll: () => Promise<void>;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  workspaceRoot: null,
  workspaceName: null,
  workspaceFiles: [],
  activeFile: null,
  openFiles: [],
  activeTabId: 'timeline',
  agentStatus: 'idle',
  currentGoal: '',
  taskStartTime: null,
  subtasks: [],
  steps: [],
  executionLogs: [],
  appliedTransactions: [],
  showReasoningDump: false,
  activeStreamText: '',
  isStreamingResponse: false,
  inlineTranscriptOpen: false,
  wizardDraft: null,
  sessionChatId: null,
  pendingProject: null,

  toggleReasoningDump: () => set((state) => ({ showReasoningDump: !state.showReasoningDump })),
  toggleInlineTranscript: () => set((state) => ({ inlineTranscriptOpen: !state.inlineTranscriptOpen })),
  setInlineTranscriptOpen: (open: boolean) => set({ inlineTranscriptOpen: open }),

  pendingChangeset: [],
  pendingDelete: null,
  pendingCommand: null,
  pendingQuestion: null,

  changesetResolver: null,
  deleteResolver: null,
  commandResolver: null,
  questionResolver: null,

  persistCurrentSession: () => {
    // The session's own task, not the selected conversation: opening a chat in the Chat mode
    // while a task runs must not stop the task from being saved.
    const sessionChatId = get().sessionChatId;
    if (!sessionChatId) return;
    const chat = storageService.getChat(sessionChatId);
    if (!chat || chat.mode !== 'agent') return;

    chat.workspaceRoot = get().workspaceRoot || undefined;
    chat.workspaceName = get().workspaceName || undefined;
    chat.agentGoal = get().currentGoal || undefined;
    chat.agentSubtasks = get().subtasks;
    chat.agentSteps = get().steps;
    chat.executionLogs = get().executionLogs;
    chat.appliedTransactions = get().appliedTransactions;
    storageService.saveChat(chat);
    // The sidebar groups tasks by folder and orders them by activity.
    useChatStore.setState({ chats: storageService.getChats() });
  },

  loadSession: async (chatId: string) => {
    const chat = storageService.getChat(chatId);
    if (!chat) return;

    // One session at a time: the task shown before stops (the sidebar asked the user first).
    if (isAgentBusy(get().agentStatus)) get().stopGoal();
    liveRunId++;
    dropPendingApprovals(get);
    set({
      sessionChatId: chatId,
      pendingChangeset: [],
      pendingDelete: null,
      pendingCommand: null,
      pendingQuestion: null,
      changesetResolver: null,
      deleteResolver: null,
      commandResolver: null,
      questionResolver: null,
    });

    // 1. Restore workspace directory if stored
    if (chat.workspaceRoot && window.electronAPI?.setWorkspacePath) {
      const res = await window.electronAPI.setWorkspacePath(chat.workspaceRoot);
      if (res.success && res.rootPath) {
        set({
          workspaceRoot: res.rootPath,
          workspaceName: res.folderName || 'Project',
        });
        storageService.setLastWorkspace(res.rootPath, res.folderName);
        await get().refreshFiles();
      } else {
        set({
          workspaceRoot: null,
          workspaceName: null,
          workspaceFiles: [],
        });
      }
    }

    // 2. Restore steps, logs, transactions, and goal
    set({
      currentGoal: chat.agentGoal || (chat.title !== 'Yeni Görev' ? chat.title : ''),
      subtasks: chat.agentSubtasks || [],
      steps: chat.agentSteps || [],
      executionLogs: chat.executionLogs || [],
      appliedTransactions: chat.appliedTransactions || [],
      agentStatus: 'idle',
      activeTabId: 'timeline',
      activeFile: null,
      openFiles: [],
      activeStreamText: '',
      isStreamingResponse: false,
      taskStartTime: null,
    });
  },

  init: async () => {
    if (!window.electronAPI) return;
    let status = await window.electronAPI.getWorkspaceStatus();
    if (!status.hasActiveWorkspace) {
      const lastWs = storageService.getLastWorkspace();
      if (lastWs?.rootPath && window.electronAPI.setWorkspacePath) {
        const res = await window.electronAPI.setWorkspacePath(lastWs.rootPath);
        if (res.success && res.rootPath) {
          status = {
            hasActiveWorkspace: true,
            rootPath: res.rootPath,
            folderName: res.folderName,
          };
        }
      }
    }

    if (status.hasActiveWorkspace && status.rootPath) {
      set({
        workspaceRoot: status.rootPath,
        workspaceName: status.folderName || 'Project',
      });
      await get().refreshFiles();
    }
  },

  openWorkspaceDialog: async () => {
    if (!window.electronAPI) return;
    const res = await window.electronAPI.openWorkspaceDialog();
    if (res.success && res.rootPath) {
      set({
        workspaceRoot: res.rootPath,
        workspaceName: res.folderName || 'Project',
        activeFile: null,
        openFiles: [],
        activeTabId: 'timeline',
      });
      storageService.setLastWorkspace(res.rootPath, res.folderName);
      get().persistCurrentSession();
      await get().refreshFiles();
    }
  },

  refreshFiles: async () => {
    if (!window.electronAPI || !get().workspaceRoot) return;
    const res = await window.electronAPI.listWorkspaceFiles({ maxDepth: 5 });
    if (res.success && res.files) {
      set({ workspaceFiles: res.files });
    }
  },

  openFile: async (relativePath: string) => {
    if (!window.electronAPI) return;
    const existing = get().openFiles.find((f) => f.relativePath === relativePath);
    if (existing) {
      set({ activeTabId: relativePath, activeFile: existing });
      return;
    }
    const res = await window.electronAPI.readWorkspaceFile(relativePath);
    if (res.success && res.content !== undefined) {
      const fileData = {
        relativePath,
        content: res.content,
        hash: res.hash || '',
      };
      set((state) => ({
        openFiles: [...state.openFiles, fileData],
        activeTabId: relativePath,
        activeFile: fileData,
      }));
    }
  },

  closeFileTab: (relativePath: string) => {
    const { openFiles, activeTabId } = get();
    const remaining = openFiles.filter((f) => f.relativePath !== relativePath);
    if (activeTabId === relativePath) {
      if (remaining.length > 0) {
        const nextActive = remaining[remaining.length - 1];
        set({
          openFiles: remaining,
          activeTabId: nextActive.relativePath,
          activeFile: nextActive,
        });
      } else {
        set({
          openFiles: [],
          activeTabId: 'timeline',
          activeFile: null,
        });
      }
    } else {
      set({ openFiles: remaining });
    }
  },

  closeAllFileTabs: () => {
    set({
      openFiles: [],
      activeTabId: 'timeline',
      activeFile: null,
    });
  },

  setActiveTabId: (id: string) => {
    if (id === 'timeline') {
      set({ activeTabId: 'timeline', activeFile: null });
    } else {
      const target = get().openFiles.find((f) => f.relativePath === id);
      set({ activeTabId: id, activeFile: target || null });
    }
  },

  closeFile: () => set({ activeFile: null, activeTabId: 'timeline' }),

  startGoal: async (goal: string, options: StartGoalOptions = {}) => {
    const trimmed = goal.trim();
    if (!trimmed || !get().workspaceRoot) return;
    const label = options.displayGoal?.trim() || trimmed;

    const selectedModel = useModelStore.getState().selectedModel || 'qwen2.5-coder:7b';

    // Synchronize agent session with unified chat store
    const chatStore = useChatStore.getState();
    const activeChatId = get().sessionChatId;
    const activeChat = chatStore.chats.find((c) => c.id === activeChatId);
    const isFollowUp = !!activeChat && activeChat.mode === 'agent' && get().steps.length > 0 && !!get().currentGoal;

    // A follow-up in the same session ("devam", "stilleri de ekle") must know what happened before;
    // previously every message started a blank run and the model had no idea what to continue.
    let previousContext: string | undefined;
    if (isFollowUp) {
      const prevSteps = get().steps;
      const finalStep = [...prevSteps].reverse().find((s) => s.type === 'final_answer');
      const changedFiles = Array.from(new Set(get().appliedTransactions.map((tx) => tx.relativePath)));
      // Only the facts: failure details of a previous run pulled models back into that detour.
      previousContext = [
        `Previous request: ${get().currentGoal}`,
        `Outcome: ${finalStep ? finalStep.content.slice(0, 800) : 'not finished'}`,
        `Files changed in this session: ${changedFiles.length > 0 ? changedFiles.join(', ') : 'none'}`,
      ].join('\n');
    }

    if (!activeChat || activeChat.mode !== 'agent') {
      set({ sessionChatId: chatStore.createNewChat(selectedModel, 'agent', label.slice(0, 32)) });
    } else {
      if (!isFollowUp) chatStore.updateChatTitle(activeChatId!, label.slice(0, 32));
      // The sidebar highlights the task that runs.
      useChatStore.setState({ activeChatId });
    }

    const runId = ++liveRunId;
    const live = () => runId === liveRunId;

    const startTime = Date.now();
    const initialSteps: AgentStep[] = [
      {
        id: `step_init_${startTime}`,
        timestamp: startTime,
        type: 'system_notice',
        content: `Görev Başlatıldı: "${label}" (Model: ${selectedModel})`,
        status: 'success',
      },
    ];
    if (options.displayGoal) {
      // The generated request stays visible (collapsed) so the user can see what the agent got.
      initialSteps.push({
        id: `step_request_${startTime}`,
        timestamp: startTime,
        type: 'system_notice',
        title: 'Sihirbazın hazırladığı istek',
        content: trimmed,
        status: 'success',
        metadata: { kind: 'generated_request' },
      });
    }
    set({
      currentGoal: trimmed,
      subtasks: [],
      agentStatus: 'thinking',
      taskStartTime: startTime,
      steps: initialSteps,
      executionLogs: [`[${new Date().toLocaleTimeString()}] Görev başlatıldı: ${label}`],
    });
    get().persistCurrentSession();

    const securityProfile = useSettingsStore.getState().settings.securityProfile || 'strict';
    const timeoutMinutes = useSettingsStore.getState().settings.circuitBreakerMinutes || 30;

    // Run Engine with Callbacks
    await agentEngine.runGoal(
      trimmed,
      selectedModel,
      {
        onSubtasksUpdated: (subtasks: TaskChecklistItem[]) => {
          if (!live()) return;
          set({ subtasks: [...subtasks] });
          get().persistCurrentSession();
        },
        onStep: (step: AgentStep) => {
          if (!live()) return;
          set((state) => ({
            steps: [...state.steps, step],
            activeStreamText: '',
            isStreamingResponse: false,
          }));
          get().persistCurrentSession();
        },
        onStatusChange: (status: AgentStatus) => {
          if (!live()) return;
          set({ agentStatus: status });
          if (status === 'finished') {
            const start = get().taskStartTime;
            const durationMs = start ? Date.now() - start : 0;
            // Bildirim sadece çok uzun süren Emir Code oturumlarında gönderilecek (>= 20 saniye)
            if (durationMs >= 20000) {
              const seconds = Math.round(durationMs / 1000);
              window.electronAPI?.notifyUser?.({
                title: 'Emir Code - Yanıt Tamamlandı',
                body: `"${get().currentGoal || 'Görev'}" başarıyla tamamlandı (${seconds} sn).`,
                flash: true,
              });
            }
            get().persistCurrentSession();
          }
          if (status === 'finished' || status === 'error' || status === 'idle') {
            set((state) => ({
              isStreamingResponse: false,
              taskStartTime: null,
              subtasks: status === 'finished'
                ? state.subtasks.map((t) => ({ ...t, status: 'completed' as const }))
                : state.subtasks.map((t) =>
                    t.status === 'in_progress' ? { ...t, status: 'pending' as const } : t
                  ),
            }));
            get().persistCurrentSession();
          }
        },
        onLog: (msg: string) => {
          if (!live()) return;
          set((state) => ({
            executionLogs: [...state.executionLogs, `[${new Date().toLocaleTimeString()}] ${msg}`],
          }));
        },
        onStreamChunk: (_chunk: string, fullResponseSoFar: string) => {
          if (!live()) return;
          set({ activeStreamText: fullResponseSoFar, isStreamingResponse: true });
        },
        onRequestChangesetApproval: (items: ChangesetItem[]) => {
          if (!live()) return Promise.resolve(false);
          window.electronAPI?.notifyUser?.({
            title: 'Emir Code - Kod Değişikliği Onayı',
            body: `${items.length} dosya için değişiklik onayı bekleniyor.`,
            flash: true,
          });
          return new Promise<boolean>((resolve) => {
            get().setPendingChangeset(items, resolve);
          });
        },
        onRequestDeleteApproval: (item: ChangesetItem) => {
          if (!live()) return Promise.resolve(false);
          window.electronAPI?.notifyUser?.({
            title: 'Emir Code - Dosya Silme Onayı',
            body: `"${item.relativePath}" dosyasını silmek için onay bekleniyor.`,
            flash: true,
          });
          return new Promise<boolean>((resolve) => {
            get().setPendingDelete(item, resolve);
          });
        },
        onRequestCommandApproval: (item: CommandApprovalItem) => {
          if (!live()) return Promise.resolve(false);
          window.electronAPI?.notifyUser?.({
            title: 'Emir Code - Komut Onayı',
            body: `"${item.binary} ${item.args.join(' ')}" komutunu çalıştırmak için onay bekleniyor.`,
            flash: true,
          });
          return new Promise<boolean>((resolve) => {
            get().setPendingCommand(item, resolve);
          });
        },
        onRequestClarification: (item: ClarificationItem) => {
          if (!live()) return Promise.resolve('');
          window.electronAPI?.notifyUser?.({
            title: 'Emir Code - Soru Soruldu',
            body: item.question || 'Ajan yanıtınızı bekliyor.',
            flash: true,
          });
          return new Promise<string>((resolve) => {
            get().setPendingQuestion(item, resolve);
          });
        },
        onTransactionApplied: (tx: AppliedTransaction) => {
          if (!live()) return;
          set((state) => ({ appliedTransactions: [tx, ...state.appliedTransactions] }));
          get().persistCurrentSession();
          get().refreshFiles();
        },
      },
      securityProfile,
      timeoutMinutes,
      {
        previousContext,
        displayGoal: options.displayGoal,
        checklist: options.checklist,
        design: options.design,
        contracts: options.contracts,
        seedFiles: options.seedFiles,
        scriptOutputs: options.scriptOutputs,
        applyFlag: options.applyFlag,
      }
    );
  },

  setWizardDraft: (draft) => set({ wizardDraft: { ...draft, nonce: Date.now() + Math.random() } }),
  clearWizardDraft: () => set({ wizardDraft: null }),

  stopGoal: () => {
    agentEngine.stop();
    set((state) => ({
      agentStatus: 'idle',
      isStreamingResponse: false,
      taskStartTime: null,
      subtasks: state.subtasks.map((t) =>
        t.status === 'in_progress' ? { ...t, status: 'pending' as const } : t
      ),
    }));
    get().persistCurrentSession();
  },

  interruptGoal: (directive: string) => {
    const trimmed = directive.trim();
    if (!trimmed) return;

    // If agent was waiting for a clarification question, resolve it with the user's directive
    const questionResolver = get().questionResolver;
    if (questionResolver) {
      get().submitAnswer(trimmed);
      return;
    }

    // If agent was waiting for changeset approval, reject current pending mutation and redirect
    const changesetResolver = get().changesetResolver;
    if (changesetResolver) {
      get().rejectChangeset();
    }

    const commandResolver = get().commandResolver;
    if (commandResolver) {
      get().rejectCommand();
    }

    const deleteResolver = get().deleteResolver;
    if (deleteResolver) {
      get().rejectDelete();
    }

    agentEngine.interrupt(trimmed);
    set({ isStreamingResponse: false, activeStreamText: '' });
  },

  clearSession: () => {
    // A cleared session cannot keep a run going in the background: its steps would land here.
    if (isAgentBusy(get().agentStatus)) get().stopGoal();
    liveRunId++;
    dropPendingApprovals(get);
    useChatStore.setState({ activeChatId: null, messages: [] });
    set({
      sessionChatId: null,
      currentGoal: '',
      subtasks: [],
      agentStatus: 'idle',
      taskStartTime: null,
      steps: [],
      executionLogs: [],
      // The rollback button must not undo the previous task's changes (maybe in another folder).
      appliedTransactions: [],
      activeStreamText: '',
      isStreamingResponse: false,
      inlineTranscriptOpen: false,
      pendingChangeset: [],
      pendingDelete: null,
      pendingCommand: null,
      pendingQuestion: null,
      changesetResolver: null,
      deleteResolver: null,
      commandResolver: null,
      questionResolver: null,
      openFiles: [],
      activeTabId: 'timeline',
      activeFile: null,
    });
  },

  confirmLeaveRunningTask: async () => {
    if (!isAgentBusy(get().agentStatus)) return true;
    const p = projectTexts();
    const stop = await confirmDialog({ title: p.leaveRunningTitle, message: p.leaveRunning, confirmLabel: p.stopTask, danger: true });
    if (!stop) return false;
    get().stopGoal();
    return true;
  },

  activateWorkspace: async (rootPath: string, folderName?: string) => {
    const name = folderName || folderNameOf(rootPath);
    set({
      workspaceRoot: rootPath,
      workspaceName: name,
      workspaceFiles: [],
      activeFile: null,
      openFiles: [],
      activeTabId: 'timeline',
    });
    storageService.setLastWorkspace(rootPath, name);
    await get().refreshFiles();
  },

  startTaskInFolder: async (root: string) => {
    if (!(await get().confirmLeaveRunningTask())) return false;
    const current = get().workspaceRoot;
    if (current && projectKey(current) === projectKey(root)) {
      get().clearSession();
      await get().refreshFiles();
      return true;
    }
    if (!window.electronAPI?.setWorkspacePath) return false;
    const res = await window.electronAPI.setWorkspacePath(root);
    if (!res.success || !res.rootPath) {
      void noticeDialog({ title: projectTexts().folderMissingTitle, message: projectTexts().folderMissingAlert.replace('{path}', root) });
      return false;
    }
    get().clearSession();
    await get().activateWorkspace(res.rootPath, res.folderName);
    return true;
  },

  createProject: async (parentDir: string, name: string) => {
    if (!window.electronAPI?.createProject) return { success: false, code: 'error' as const };
    const res = await window.electronAPI.createProject(parentDir, name);
    if (!res.success || !res.rootPath) return { success: false, code: res.code || 'error', error: res.error };
    get().clearSession();
    await get().activateWorkspace(res.rootPath, res.folderName);
    return { success: true };
  },

  setPendingProject: (project) => set({ pendingProject: project }),

  createPendingProject: async () => {
    const pending = get().pendingProject;
    if (!pending) return true;
    const res = await get().createProject(pending.parentDir, pending.name);
    if (!res.success) {
      void noticeDialog({ title: projectTexts().createFailedTitle, message: describeProjectError(projectTexts(), res.code, res.error) });
      return false;
    }
    set({ pendingProject: null });
    return true;
  },

  openExistingProject: async () => {
    if (!window.electronAPI) return false;
    if (!(await get().confirmLeaveRunningTask())) return false;
    const res = await window.electronAPI.openWorkspaceDialog();
    if (!res.success || !res.rootPath) return false;
    get().clearSession();
    await get().activateWorkspace(res.rootPath, res.folderName);
    return true;
  },

  // Changeset Handlers
  setPendingChangeset: (items, resolver) => {
    set({
      pendingChangeset: items.map((i) => ({ ...i, selected: true })),
      changesetResolver: resolver,
      agentStatus: 'waiting_changeset_approval',
    });
  },

  toggleChangesetItem: (id: string) => {
    set((state) => ({
      pendingChangeset: state.pendingChangeset.map((item) =>
        item.id === id ? { ...item, selected: !item.selected } : item
      ),
    }));
  },

  selectAllChangeset: (selected: boolean) => {
    set((state) => ({
      pendingChangeset: state.pendingChangeset.map((item) => ({ ...item, selected })),
    }));
  },

  approveSelectedChangeset: async () => {
    const resolver = get().changesetResolver;
    if (resolver) {
      resolver(true);
    }
    set({ pendingChangeset: [], changesetResolver: null });
  },

  rejectChangeset: () => {
    const resolver = get().changesetResolver;
    if (resolver) {
      resolver(false);
    }
    set({ pendingChangeset: [], changesetResolver: null, agentStatus: 'thinking' });
  },

  // Delete Handlers
  setPendingDelete: (item, resolver) => {
    set({
      pendingDelete: item,
      deleteResolver: resolver,
      agentStatus: 'waiting_delete_approval',
    });
  },

  approveDelete: async () => {
    const resolver = get().deleteResolver;
    if (resolver) resolver(true);
    set({ pendingDelete: null, deleteResolver: null });
  },

  rejectDelete: () => {
    const resolver = get().deleteResolver;
    if (resolver) resolver(false);
    set({ pendingDelete: null, deleteResolver: null, agentStatus: 'thinking' });
  },

  // Command Handlers
  setPendingCommand: (item, resolver) => {
    set({
      pendingCommand: item,
      commandResolver: resolver,
      agentStatus: 'waiting_command_approval',
    });
  },

  approveCommand: async () => {
    const resolver = get().commandResolver;
    if (resolver) resolver(true);
    set({ pendingCommand: null, commandResolver: null });
  },

  rejectCommand: () => {
    const resolver = get().commandResolver;
    if (resolver) resolver(false);
    set({ pendingCommand: null, commandResolver: null, agentStatus: 'thinking' });
  },

  // Clarification Handlers
  setPendingQuestion: (item, resolver) => {
    set({
      pendingQuestion: item,
      questionResolver: resolver,
      agentStatus: 'waiting_clarification',
    });
  },

  submitAnswer: (answer: string) => {
    const resolver = get().questionResolver;
    if (resolver) resolver(answer);
    set({ pendingQuestion: null, questionResolver: null, agentStatus: 'thinking' });
  },

  // Rollback Handlers
  rollbackTransaction: async (txId: string, force = false) => {
    if (!window.electronAPI) return { success: false, error: 'API kullanılamıyor' };
    const res = await window.electronAPI.rollbackTransaction(txId, force);
    if (res.success) {
      set((state) => ({
        appliedTransactions: state.appliedTransactions.filter((t) => t.transactionId !== txId),
      }));
      await get().refreshFiles();
    }
    return res;
  },

  rollbackAll: async () => {
    const list = [...get().appliedTransactions];
    for (const tx of list) {
      await get().rollbackTransaction(tx.transactionId, true);
    }
  },
}));
