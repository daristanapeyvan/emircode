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
import { WorkspaceFileInfo } from '../../electron/preload';
import { agentEngine } from '@/lib/agent/AgentEngine';
import type { WizardDraft, WizardRunOptions } from '@/lib/wizard/composer';
import { storageService } from '@/lib/storage/StorageService';
import { useModelStore } from './modelStore';
import { useChatStore } from './chatStore';
import { useSettingsStore } from './settingsStore';

/** Extras of a run started from a wizard (a request typed by hand sends none). */
export type StartGoalOptions = WizardRunOptions;

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
  clearSession: () => void;

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
    const activeChatId = useChatStore.getState().activeChatId;
    if (!activeChatId) return;
    const chat = storageService.getChat(activeChatId);
    if (!chat || chat.mode !== 'agent') return;

    chat.workspaceRoot = get().workspaceRoot || undefined;
    chat.workspaceName = get().workspaceName || undefined;
    chat.agentGoal = get().currentGoal || undefined;
    chat.agentSubtasks = get().subtasks;
    chat.agentSteps = get().steps;
    chat.executionLogs = get().executionLogs;
    chat.appliedTransactions = get().appliedTransactions;
    storageService.saveChat(chat);
  },

  loadSession: async (chatId: string) => {
    const chat = storageService.getChat(chatId);
    if (!chat) return;

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
    const activeChatId = chatStore.activeChatId;
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
      chatStore.createNewChat(selectedModel, 'agent', label.slice(0, 32));
    } else if (!isFollowUp) {
      chatStore.updateChatTitle(activeChatId!, label.slice(0, 32));
    }

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
          set({ subtasks: [...subtasks] });
          get().persistCurrentSession();
        },
        onStep: (step: AgentStep) => {
          set((state) => ({
            steps: [...state.steps, step],
            activeStreamText: '',
            isStreamingResponse: false,
          }));
          get().persistCurrentSession();
        },
        onStatusChange: (status: AgentStatus) => {
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
          set((state) => ({
            executionLogs: [...state.executionLogs, `[${new Date().toLocaleTimeString()}] ${msg}`],
          }));
        },
        onStreamChunk: (_chunk: string, fullResponseSoFar: string) => {
          set({ activeStreamText: fullResponseSoFar, isStreamingResponse: true });
        },
        onRequestChangesetApproval: (items: ChangesetItem[]) => {
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
    useChatStore.setState({ activeChatId: null, messages: [] });
    set({
      currentGoal: '',
      subtasks: [],
      agentStatus: 'idle',
      taskStartTime: null,
      steps: [],
      executionLogs: [],
      activeStreamText: '',
      isStreamingResponse: false,
      inlineTranscriptOpen: false,
      pendingChangeset: [],
      pendingDelete: null,
      pendingCommand: null,
      pendingQuestion: null,
      openFiles: [],
      activeTabId: 'timeline',
      activeFile: null,
    });
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
